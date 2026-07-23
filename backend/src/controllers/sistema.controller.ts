import { readFile } from "fs/promises";
import { Request, Response } from "express";
import { env } from "../config/env";

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
