import { Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

// ---------- Catálogo de acciones auditadas ----------
// Un lugar único para los nombres, así no se escriben distinto en cada controller.
export const ACCIONES = {
  LOGIN: "LOGIN",
  LOGIN_FALLIDO: "LOGIN_FALLIDO",
  LOGIN_BLOQUEADO: "LOGIN_BLOQUEADO",
  LOGOUT: "LOGOUT",
  PASSWORD_CAMBIADA: "PASSWORD_CAMBIADA",
  USUARIO_CREADO: "USUARIO_CREADO",
  USUARIO_MODIFICADO: "USUARIO_MODIFICADO",
  USUARIO_PASSWORD_RESET: "USUARIO_PASSWORD_RESET",
  CASO_CREADO_MANUAL: "CASO_CREADO_MANUAL",
  CASO_EDITADO: "CASO_EDITADO",
  CASO_ELIMINADO: "CASO_ELIMINADO",
  CASO_RESTAURADO: "CASO_RESTAURADO",
  RQR_CREADO: "RQR_CREADO",
  RQR_MODIFICADO: "RQR_MODIFICADO",
  RQR_CERRADO: "RQR_CERRADO",
  RQR_ACTUALIZADO_POR_NUEVA_RESPUESTA: "RQR_ACTUALIZADO_POR_NUEVA_RESPUESTA",
  RQR_ELIMINADO: "RQR_ELIMINADO",
  RQR_RESTAURADO: "RQR_RESTAURADO",
  RQR_IMPORTADO: "RQR_IMPORTADO",
  CAMPANA_ENVIADA: "CAMPANA_ENVIADA",
  ENVIO_REINTENTADO: "ENVIO_REINTENTADO",
  EXCEL_IMPORTADO: "EXCEL_IMPORTADO",
  EXCEL_UPLOAD_ELIMINADO: "EXCEL_UPLOAD_ELIMINADO",
  EXCEL_UPLOAD_RESTAURADO: "EXCEL_UPLOAD_RESTAURADO",
  SENTIMENT_CORREGIDO: "SENTIMENT_CORREGIDO",
  // Seguimiento (chat interno): respuesta manual y reenvío de plantilla
  SEGUIMIENTO_RESPUESTA: "SEGUIMIENTO_RESPUESTA",
  SEGUIMIENTO_PLANTILLA: "SEGUIMIENTO_PLANTILLA",
  CONFIGURACION_MODIFICADA: "CONFIGURACION_MODIFICADA",
  // Parte B: encuesta Ford + tareas de refuerzo
  EXCEL_ENCUESTA_FORD_IMPORTADO: "EXCEL_ENCUESTA_FORD_IMPORTADO",
  TAREA_ASIGNADA: "TAREA_ASIGNADA",
  TAREA_REASIGNADA: "TAREA_REASIGNADA",
  TAREAS_REDISTRIBUIDAS: "TAREAS_REDISTRIBUIDAS",
  TAREA_VINCULADA: "TAREA_VINCULADA",
  TAREA_ACTUALIZADA: "TAREA_ACTUALIZADA",
  TAREA_COMPLETADA: "TAREA_COMPLETADA",
  TAREA_CERRADA_AUTO: "TAREA_CERRADA_AUTO",
  TAREA_CANCELADA_AUTO: "TAREA_CANCELADA_AUTO",
  // Lista de supresión por teléfono
  SUPRESION_AGREGADA: "SUPRESION_AGREGADA",
  SUPRESION_ELIMINADA: "SUPRESION_ELIMINADA",
  // Alias de normalización (asesor/sucursal)
  ALIAS_CREADO: "ALIAS_CREADO",
  ALIAS_ELIMINADO: "ALIAS_ELIMINADO",
} as const;

// ---------- Extracción de IP / user-agent ----------
// Con `trust proxy` activo, req.ip refleja el X-Forwarded-For que pone nginx.

export function ipDe(req: Request): string {
  const ip = req.ip || req.socket?.remoteAddress || "desconocida";
  return ip.replace(/^::ffff:/, ""); // normaliza IPv4 mapeadas en IPv6
}

export function userAgentDe(req: Request): string {
  const ua = req.headers["user-agent"];
  return (Array.isArray(ua) ? ua[0] : ua ?? "desconocido").slice(0, 500);
}

export interface DatosAuditoria {
  accion: string;
  entidad: string;
  entidadId?: string | null;
  // Contexto (estado antes/después, contadores, etc.). NUNCA contraseñas,
  // tokens ni API keys: quien llama es responsable de no pasar secretos acá.
  detalles?: unknown;
  // Para acciones sin sesión (login fallido) o del sistema, se pasa explícito.
  usuarioId?: string | null;
}

/**
 * Registra una acción en AuditLog. NUNCA lanza: la auditoría es un efecto
 * lateral que no debe voltear la operación de negocio. Si falla, se loguea
 * a la consola y sigue. Para acciones del sistema (cron) se pasa req=null.
 */
export async function auditar(req: Request | null, datos: DatosAuditoria): Promise<void> {
  try {
    const usuarioId =
      datos.usuarioId !== undefined ? datos.usuarioId : req?.usuario?.id ?? null;
    await prisma.auditLog.create({
      data: {
        usuarioId,
        accion: datos.accion,
        entidad: datos.entidad,
        entidadId: datos.entidadId ?? null,
        detalles:
          datos.detalles === undefined || datos.detalles === null
            ? Prisma.JsonNull
            : (datos.detalles as Prisma.InputJsonValue),
        ip: req ? ipDe(req) : "sistema",
        userAgent: req ? userAgentDe(req) : "sistema",
      },
    });
  } catch (err) {
    console.error(`[auditoria] no se pudo registrar la acción ${datos.accion}:`, err);
  }
}
