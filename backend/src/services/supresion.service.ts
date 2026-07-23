import { MotivoSupresion } from "@prisma/client";
import { prisma } from "../config/prisma";
import { normalizarTelefonoAR } from "./telefono.service";

// Lista de supresión POR TELÉFONO: quien está acá nunca recibe una campaña de
// WhatsApp, aunque el mes que viene el Excel le genere un caso nuevo (el flag
// whatsappOptOut es por caso y se perdería en la re-importación).

/** Agrega un teléfono a la supresión de forma idempotente. */
export async function agregarSupresion(params: {
  telefono: unknown;
  motivo: MotivoSupresion;
  casoOrigenId?: string | null;
  creadoPorId?: string | null;
  notas?: string | null;
}): Promise<{ agregado: boolean; telefono: string | null; yaExistia: boolean }> {
  const tel = normalizarTelefonoAR(params.telefono);
  if (!tel) return { agregado: false, telefono: null, yaExistia: false };

  const existente = await prisma.supresionContacto.findUnique({ where: { telefono: tel } });
  if (existente) return { agregado: false, telefono: tel, yaExistia: true };

  await prisma.supresionContacto.create({
    data: {
      telefono: tel,
      motivo: params.motivo,
      casoOrigenId: params.casoOrigenId ?? null,
      creadoPorId: params.creadoPorId ?? null,
      notas: params.notas ?? null,
    },
  });
  return { agregado: true, telefono: tel, yaExistia: false };
}

/** Conjunto de todos los teléfonos suprimidos (E.164). */
export async function telefonosSuprimidos(): Promise<Set<string>> {
  const filas = await prisma.supresionContacto.findMany({ select: { telefono: true } });
  return new Set(filas.map((f) => f.telefono));
}

/** ¿Alguno de los teléfonos normalizados del caso está suprimido? */
export function estaSuprimido(telefonosNorm: string[], suprimidos: Set<string>): boolean {
  return telefonosNorm.some((t) => suprimidos.has(t));
}
