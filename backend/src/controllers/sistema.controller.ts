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

// Cuántas horas puede tener el último respaldo bueno antes de mostrarse en rojo.
// 72 y no 24 porque las PCs se apagan el fin de semana: un lunes a la mañana el
// último respaldo legítimamente es del viernes. Es el mismo número con el que el
// vigilante decide avisar por correo, para que la pantalla y el mail no se
// contradigan.
const HORAS_RESPALDO_VENCIDO = 72;

async function leerJson(ruta: string): Promise<unknown | null> {
  try {
    const crudo = await readFile(ruta, "utf8");
    // El script de Windows escribe sin BOM, pero un archivo viejo puede tenerlo y
    // JSON.parse se cae con el BOM adelante.
    return JSON.parse(crudo.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

// Lo que escribe scripts\windows\Respaldo-Calidad.ps1 en Respaldos\ultimo-respaldo.json
interface RespaldoWindows {
  fecha?: string;
  ok?: boolean;
  archivo?: string | null;
  bytes?: number;
  bases?: Array<{ base: string; archivo: string; bytes: number }>;
  basesFallidas?: string[];
  destinosOffsite?: string[];
  rutasOffsite?: string[];
  error?: string | null;
}

export async function estadoBackup(_req: Request, res: Response) {
  const [contenedor, windows] = await Promise.all([
    leerJson(env.backupStatusFile),
    leerJson(env.respaldoWindowsFile) as Promise<RespaldoWindows | null>,
  ]);

  // El respaldo a OneDrive es el principal: es el único que deja la copia FUERA
  // de esta PC. Se calcula acá la antigüedad (y no en la pantalla) para que el
  // "hace 10 días" no dependa de la hora del navegador.
  let respaldoNube = null;
  if (windows) {
    const fecha = windows.fecha ? new Date(windows.fecha) : null;
    const valida = fecha && !Number.isNaN(fecha.getTime());
    const horas = valida ? (Date.now() - fecha!.getTime()) / 3_600_000 : null;
    respaldoNube = {
      fecha: valida ? fecha!.toISOString() : null,
      ok: windows.ok === true,
      archivo: windows.archivo ?? null,
      bytes: windows.bytes ?? 0,
      bases: windows.bases ?? [],
      destinos: windows.destinosOffsite ?? [],
      rutas: windows.rutasOffsite ?? [],
      error: windows.error ?? null,
      horas: horas === null ? null : Math.round(horas),
      // Vencido = pasó demasiado tiempo desde el último que SALIÓ de la PC. Un
      // respaldo fallado cuenta como vencido aunque sea de hoy: la foto anterior
      // decía "ok" y así fue como Ford estuvo 19 días sin respaldo sin que nadie
      // se enterara.
      vencido: windows.ok !== true || horas === null || horas > HORAS_RESPALDO_VENCIDO,
    };
  }

  const estadoContenedor = (contenedor ?? {}) as Record<string, unknown>;
  res.json({
    // "configurado" sigue significando lo mismo que antes (el contenedor de
    // backup ya corrió alguna vez), porque la pantalla lo usa para ese bloque.
    configurado: contenedor !== null,
    mensaje:
      contenedor === null
        ? "El backup interno de Docker todavía no corrió (corre de madrugada, con la PC apagada)."
        : undefined,
    ultimoBackup: null,
    ultimaVerificacion: null,
    ...estadoContenedor,
    respaldoNube,
    mensajeRespaldoNube:
      respaldoNube === null
        ? "Todavía no hay ningún registro del respaldo diario a OneDrive. Se hace a las 12:00, con la PC prendida."
        : undefined,
  });
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
