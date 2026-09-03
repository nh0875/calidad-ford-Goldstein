import { readFile } from "fs/promises";
import { Request, Response } from "express";
import { env } from "../config/env";
import {
  Caida,
  VENTANA_SEGURA_HORAS,
  caidasRegistradas,
  casosEnRiesgo,
} from "../services/latido.service";

// GET /api/sistema/estado-backup — solo ADMIN. Lee el archivo JSON de estado que
// escribe el contenedor de backup (en un volumen compartido), para ver desde el
// dashboard cuándo fue el último backup exitoso y si la última verificación de
// integridad pasó, sin entrar al servidor por SSH.
//
// Forma esperada del archivo (lo escriben backup.sh / verify-backup.sh):
//   {
//     "ultimoBackup": { "fecha": ISO, "ok": bool, "archivo": str, "tamanoBytes": num,
//                       "subidoAOffsite": bool, "mensaje": str },
//     "ultimaVerificacion": { "fecha": ISO, "ok": bool, "filasCaso": num, "mensaje": str }
//   }

export async function estadoBackup(_req: Request, res: Response) {
  try {
    const crudo = await readFile(env.backupStatusFile, "utf8");
    const estado = JSON.parse(crudo);
    res.json({ configurado: true, ...estado });
  } catch (err: unknown) {
    const noExiste = (err as NodeJS.ErrnoException)?.code === "ENOENT";
    res.json({
      configurado: false,
      mensaje: noExiste
        ? "Todavía no hay ningún registro de backup. Si el sistema de backups está activo, aparecerá tras la primera corrida."
        : "No se pudo leer el estado del backup.",
      ultimoBackup: null,
      ultimaVerificacion: null,
    });
  }
}

// GET /api/sistema/caidas — solo ADMIN.
//
// Para qué: cuando la PC de la agencia estuvo apagada, Meta no pudo entregar las
// respuestas de los clientes. Las reintenta, pero su documentación se contradice
// sobre cuánto (7 días en la página de WhatsApp, 36 horas en la genérica), así
// que se toma el peor caso. Un apagón más largo que eso pudo costar mensajes, y
// no hay forma de pedírselos a Meta después: no existe el endpoint.
//
// Esto contesta dos cosas: cuándo estuvo caído el sistema, y —para la caída más
// reciente que superó la ventana— a qué clientes conviene pedirles que repitan
// con la plantilla de "no nos llegó tu mensaje".
export async function caidas(_req: Request, res: Response) {
  const lista = await caidasRegistradas();
  const riesgosas = lista.filter((c) => c.riesgosa);

  // Solo se calculan los afectados de la última caída riesgosa: es la única
  // sobre la que todavía tiene sentido actuar.
  let ultimaRiesgosa: Caida | null = riesgosas[0] ?? null;
  let afectados: Awaited<ReturnType<typeof casosEnRiesgo>> = [];
  if (ultimaRiesgosa) {
    afectados = await casosEnRiesgo(ultimaRiesgosa);
  }

  res.json({
    ventanaSeguraHoras: VENTANA_SEGURA_HORAS,
    caidas: lista,
    hayRiesgo: riesgosas.length > 0,
    ultimaRiesgosa,
    afectados,
    mensaje: ultimaRiesgosa
      ? `El sistema estuvo caído ${(ultimaRiesgosa.minutos / 60).toFixed(1)} h, más que las ` +
        `${VENTANA_SEGURA_HORAS} h que Meta garantiza de reintentos. Estos ${afectados.length} ` +
        `casos esperaban respuesta en esa franja: puede que hayan contestado y no nos llegara. ` +
        `Conviene mandarles la plantilla de "no nos llegó tu mensaje".`
      : "No hubo ninguna caída que supere la ventana de reintentos de Meta.",
  });
}
