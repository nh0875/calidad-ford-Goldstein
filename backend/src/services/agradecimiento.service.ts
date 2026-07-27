import { MessageDirection, MotivoSupresion } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { agradecimientoQueue } from "../jobs/queues";
import { agregarSupresion } from "./supresion.service";

// ---------- Opt-out (BAJA / STOP) ----------
// Si el cliente pide la baja, se marca el caso y NO se le manda ningún
// automatismo. El opt-out siempre gana.

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,;!¡¿?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function esMensajeOptOut(texto: string): boolean {
  const t = normalizar(texto);
  if (!t) return false;
  // Palabras sueltas INEQUÍVOCAS de baja. OJO: "baja" y "cancelar" NO van acá —
  // en posventa son normalísimas ("la nota es muy baja", "quiero cancelar el
  // turno") y un falso positivo suprime al cliente de TODAS las campañas (la
  // supresión es permanente). Solo disparan dentro de frases explícitas de baja.
  if (/(^| )(stop|unsubscribe)( |$)/.test(t)) return true;
  // Frases de baja explícitas (incluye "darse de baja" y "cancelar la suscripción").
  if (
    /(darme de baja|darse de baja|darte de baja|de baja de|no quiero recibir|no me escriban|no me contacten|no me manden|dejen de escribir|dejen de enviar|desuscrib|cancelar (la )?suscrip)/.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/** Marca el opt-out del caso si el texto entrante lo dispara. Devuelve true si marcó. */
export async function marcarOptOutSiCorresponde(casoId: string, texto: string): Promise<boolean> {
  if (!esMensajeOptOut(texto)) return false;
  const caso = await prisma.caso.update({
    where: { id: casoId },
    data: { whatsappOptOut: true },
    select: { id: true, whatsapp: true, celular: true },
  });
  // Además del flag por caso, sumar el teléfono a la lista de supresión global,
  // para que un caso NUEVO del mismo cliente (re-importación del mes siguiente)
  // tampoco reciba campañas. Idempotente.
  await agregarSupresion({
    telefono: caso.whatsapp || caso.celular,
    motivo: MotivoSupresion.OPT_OUT_WHATSAPP,
    casoOrigenId: caso.id,
  });
  return true;
}

// ---------- Armado del mensaje con placeholders ----------
// Placeholders soportados: {nombre} {email} {modelo}

function primerNombre(nombreCompleto: string): string {
  const limpio = (nombreCompleto ?? "").trim();
  if (!limpio) return "cliente";
  // Formato "APELLIDO, NOMBRE" (por si viniera de un cruce): tomar lo de después de la coma
  if (limpio.includes(",")) {
    const nombre = limpio.split(",")[1]?.trim();
    if (nombre) return nombre.split(/\s+/)[0];
  }
  return limpio.split(/\s+/)[0];
}

export function reemplazarPlaceholders(
  texto: string,
  datos: { nombrePropietario: string; emailPropietario: string | null; modelo: string }
): string {
  const email = (datos.emailPropietario ?? "").trim();
  return texto
    .replaceAll("{nombre}", primerNombre(datos.nombrePropietario))
    // Edge: sin email, redacción alternativa (no dejar "{email}" ni un hueco raro)
    .replaceAll("{email}", email || "de correo registrada en Ford")
    .replaceAll("{modelo}", (datos.modelo ?? "").trim() || "tu vehículo");
}

// ---------- Programación (con debounce) ----------
// Se llama cuando termina el análisis. El agradecimiento se programa para salir
// DELAY_AGRADECIMIENTO_MS después del ÚLTIMO mensaje ENTRANTE del cliente (no
// después del análisis). Si el cliente sigue escribiendo, cada nuevo análisis
// reprograma (mismo jobId determinístico) tomando siempre el último entrante.

export async function programarAgradecimiento(casoId: string): Promise<void> {
  const caso = await prisma.caso.findUnique({
    where: { id: casoId },
    select: { id: true, eliminadoEn: true, agradecimientoEnviadoEn: true, whatsappOptOut: true },
  });
  if (!caso || caso.eliminadoEn) return;
  if (caso.agradecimientoEnviadoEn) return; // una sola vez por caso
  if (caso.whatsappOptOut) return; // opt-out gana

  const ultimoEntrante = await prisma.whatsappMessage.findFirst({
    where: { casoId, direction: MessageDirection.ENTRANTE },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const base = ultimoEntrante?.createdAt.getTime() ?? Date.now();
  const delay = Math.max(0, env.delayAgradecimientoMs - (Date.now() - base));

  const jobId = `agradecimiento-${casoId}`;
  // Debounce: se quita el job pendiente y se reprograma al último mensaje
  try {
    await agradecimientoQueue.remove(jobId);
  } catch {
    // no existía; está bien
  }
  await agradecimientoQueue.add(
    "enviar-agradecimiento",
    { casoId },
    {
      jobId,
      delay,
      attempts: 3,
      backoff: { type: "exponential", delay: 15_000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    }
  );
}
