// Envío de correo del sistema.
//
// Hasta ahora el sistema no mandaba un solo mail: todo salía por WhatsApp. Lo
// necesita el Refuerzo de encuesta de Volkswagen, donde los vendedores NO entran
// al sistema — la administradora les asigna los clientes y a cada uno le llega
// por mail el detalle de los suyos.
//
// Va por SMTP de Gmail / Google Workspace con una CONTRASEÑA DE APLICACIÓN
// (Google no acepta la contraseña normal de la cuenta desde 2022). Se genera en
// la cuenta: Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones.
//
// Si no hay credenciales cargadas, el sistema NO falla: `mailHabilitado()`
// devuelve false y quien lo llama muestra los destinatarios en pantalla para
// copiar y pegar. Un módulo entero no puede quedar inutilizable porque falte
// una variable de entorno.
import nodemailer, { Transporter } from "nodemailer";
import { env } from "../config/env";
import { marca } from "../config/marca";

let transporte: Transporter | null | undefined;

/** ¿Hay credenciales de correo cargadas? */
export function mailHabilitado(): boolean {
  return Boolean(env.mail.usuario && env.mail.password);
}

function obtenerTransporte(): Transporter | null {
  if (transporte !== undefined) return transporte;
  if (!mailHabilitado()) {
    transporte = null;
    return null;
  }
  transporte = nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.puerto,
    // 465 = TLS directo; 587 = STARTTLS. Gmail acepta los dos.
    secure: env.mail.puerto === 465,
    auth: { user: env.mail.usuario, pass: env.mail.password },
  });
  return transporte;
}

export interface MailAEnviar {
  para: string;
  asunto: string;
  /** Cuerpo en texto plano. Se usa como alternativa del HTML. */
  texto: string;
  html: string;
}

export class MailError extends Error {}

/**
 * Manda UN correo. Lanza MailError con un mensaje entendible si no se pudo:
 * quien llama decide si corta todo o sigue con el resto de los destinatarios.
 */
export async function enviarMail(mail: MailAEnviar): Promise<void> {
  const t = obtenerTransporte();
  if (!t) {
    throw new MailError(
      "No hay una casilla de correo configurada. Cargá MAIL_USUARIO y MAIL_PASSWORD " +
        "(contraseña de aplicación de Google) en el archivo de entorno."
    );
  }
  try {
    await t.sendMail({
      from: `"Calidad ${marca.nombre}" <${env.mail.usuario}>`,
      to: mail.para,
      subject: mail.asunto,
      text: mail.texto,
      html: mail.html,
    });
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    // El error crudo de SMTP no le dice nada a quien está en la pantalla.
    throw new MailError(
      /invalid login|username and password not accepted|BadCredentials/i.test(detalle)
        ? "Google rechazó las credenciales. Verificá que MAIL_PASSWORD sea una CONTRASEÑA DE APLICACIÓN (no la contraseña de la cuenta) y que la verificación en 2 pasos esté activada."
        : `No se pudo enviar el correo: ${detalle}`
    );
  }
}

/** Verifica la conexión con el servidor (para el botón "probar" de la pantalla). */
export async function probarConexionMail(): Promise<{ ok: boolean; mensaje: string }> {
  const t = obtenerTransporte();
  if (!t) {
    return { ok: false, mensaje: "No hay una casilla de correo configurada." };
  }
  try {
    await t.verify();
    return { ok: true, mensaje: `Conexión correcta con ${env.mail.usuario}.` };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No se pudo conectar con el servidor de correo.",
    };
  }
}
