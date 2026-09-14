// ---------------------------------------------------------------------------
// Que lo que entra por el webhook venga DE VERDAD de Meta
// ---------------------------------------------------------------------------
//
// El webhook es la única puerta del sistema que no pide sesión: Meta no puede
// loguearse. Sin esta validación, cualquiera que conozca la URL puede mandar un
// POST inventado y el sistema lo toma como un cliente real: da de baja números
// (opt-out), marca casos como respondidos, abre RQR por quejas que nadie hizo y
// gasta cuota de la IA. Mientras el sistema vivió en una PC detrás de un túnel
// con URL rara, el riesgo era chico. En un servidor con dominio propio, no.
//
// Meta firma cada notificación: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256 del
// cuerpo CRUDO con el App Secret de la app. Se recalcula y se compara.
//
// SI NO HAY APP SECRET CARGADO, DEJA PASAR (con un aviso en el log). Es a
// propósito: las PCs de hoy no lo tienen, y cortar la entrada de mensajes reales
// por una variable que falta sería peor que el riesgo que esto viene a cerrar.
// En el servidor va cargado, y ahí sí se rechaza todo lo que no esté firmado.

import crypto from "crypto";
import { Request, RequestHandler } from "express";
import { env } from "../config/env";

/** El cuerpo tal como llegó, antes de parsearlo. Lo guarda app.ts solo para /api/webhooks. */
export type RequestConCuerpoCrudo = Request & { rawBody?: Buffer };

let avisadoSinSecreto = false;

export const verificarFirmaMeta: RequestHandler = (req, res, next) => {
  const secreto = env.meta.appSecret;
  if (!secreto) {
    if (!avisadoSinSecreto) {
      console.warn(
        "[webhook] META_APP_SECRET vacío: se aceptan notificaciones SIN verificar que vengan de Meta. " +
          "En un servidor expuesto a internet hay que cargarlo."
      );
      avisadoSinSecreto = true;
    }
    return next();
  }

  const cabecera = req.get("x-hub-signature-256") ?? "";
  const crudo = (req as RequestConCuerpoCrudo).rawBody;
  if (!crudo || !cabecera.startsWith("sha256=")) {
    console.warn(`[webhook] notificación rechazada: sin firma de Meta (ip ${req.ip}).`);
    return res.sendStatus(401);
  }

  const esperada = Buffer.from(crypto.createHmac("sha256", secreto).update(crudo).digest("hex"), "hex");
  const recibida = Buffer.from(cabecera.slice("sha256=".length), "hex");
  // timingSafeEqual exige el mismo largo; una firma mal formada da otro largo.
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) {
    console.warn(
      `[webhook] notificación rechazada: la firma no coincide (ip ${req.ip}). ` +
        "Si es Meta, el META_APP_SECRET cargado no es el de esta app."
    );
    return res.sendStatus(401);
  }

  next();
};
