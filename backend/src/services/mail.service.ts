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
    // UNA sola conexión para toda la tanda, en vez de abrir y volver a iniciar
    // sesión en cada correo (21-09-2026). Avisando a los vendedores salen 15
    // correos seguidos: eran 15 inicios de sesión en pocos segundos y Google
    // cortaba alguno con "Username and Password not accepted", con la MISMA
    // contraseña que aceptaba un segundo después. Se vio en la pantalla: el
    // mismo mail fallaba en un renglón y salía en otro.
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    // Un correo por segundo como mucho: es de sobra para una tanda de 15 y
    // mantiene a Google tranquilo.
    rateDelta: 1000,
    rateLimit: 1,
  });
  return transporte;
}

export interface MailAEnviar {
  para: string;
  /** Direcciones en copia (CC), separadas por coma. Vacío = sin copia. */
  copia?: string;
  asunto: string;
  /** Cuerpo en texto plano. Se usa como alternativa del HTML. */
  texto: string;
  html: string;
}

export class MailError extends Error {}

/** Cuántas veces se intenta cada correo antes de darlo por perdido. */
const INTENTOS = 3;
/** Cuánto se espera antes de cada reintento (el primero no espera). */
const ESPERA_MS = [0, 3000, 9000];

/**
 * ¿Este error es de los que se arreglan solos reintentando?
 *
 * Todo lo 4xx de SMTP significa "ahora no, probá más tarde". El 535 es aparte:
 * según el protocolo es definitivo ("usuario o contraseña"), pero Google lo usa
 * TAMBIÉN cuando corta por demasiados inicios de sesión seguidos. Como no hay
 * forma de distinguirlos por el código, se reintenta igual: si de verdad la
 * contraseña está mal, se pierden unos segundos y el mensaje final lo dice.
 */
function esPasajero(err: unknown): boolean {
  const e = err as { code?: unknown; responseCode?: unknown };
  const codigo = String(e?.code ?? "");
  const respuesta = Number(e?.responseCode ?? 0);
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET", "EPIPE", "EAUTH"].includes(codigo)) return true;
  if (respuesta >= 400 && respuesta < 500) return true;
  return respuesta === 535;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Si ya salió al menos un correo desde que arrancó el sistema, la contraseña
 * anda. Sirve para no acusar a la contraseña cuando lo que pasó fue que Google
 * cortó un envío suelto en medio de una tanda.
 */
let huboEnvioExitoso = false;

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
  let ultimo: unknown = null;
  for (let intento = 0; intento < INTENTOS; intento++) {
    if (ESPERA_MS[intento]) await esperar(ESPERA_MS[intento]);
    try {
      await t.sendMail({
        from: `"Calidad ${marca.nombre}" <${env.mail.usuario}>`,
        to: mail.para,
        // Solo se manda el CC si hay algo: un cc vacío hace que algunos servidores
        // rechacen el mensaje entero.
        ...(mail.copia && mail.copia.trim() ? { cc: mail.copia.trim() } : {}),
        subject: mail.asunto,
        text: mail.texto,
        html: mail.html,
      });
      huboEnvioExitoso = true;
      return;
    } catch (err) {
      ultimo = err;
      // Un rechazo de verdad (dirección inexistente, mensaje rechazado) no
      // mejora reintentando: se corta acá y se dice qué pasó.
      if (!esPasajero(err)) break;
    }
  }

  const detalle = ultimo instanceof Error ? ultimo.message : String(ultimo);
  const pareceCredenciales = /invalid login|username and password not accepted|BadCredentials/i.test(detalle);
  // El error crudo de SMTP no le dice nada a quien está en la pantalla.
  throw new MailError(
    pareceCredenciales && huboEnvioExitoso
      ? "Google cortó este correo. Suele pasar cuando salen muchos seguidos; los demás sí salieron. " +
          `Se reintentó ${INTENTOS} veces. Volvé a apretar el botón: se reintenta solo con los que faltan.`
      : pareceCredenciales
        ? "Google rechazó las credenciales. Verificá que MAIL_PASSWORD sea una CONTRASEÑA DE APLICACIÓN (no la contraseña de la cuenta) y que la verificación en 2 pasos esté activada."
        : `No se pudo enviar el correo: ${detalle}`
  );
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
