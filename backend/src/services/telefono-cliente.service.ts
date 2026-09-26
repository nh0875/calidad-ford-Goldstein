// ---------------------------------------------------------------------------
// El teléfono del cliente de la encuesta de fábrica
// ---------------------------------------------------------------------------
//
// Pedido de Calidad (25-09-2026): cuando se le avisa a un vendedor que tiene que
// contactar a un cliente, el correo tiene que llevar también su teléfono.
//
// El Excel de la encuesta de fábrica NO trae teléfono: trae nombre, correo,
// dominio, canal y la fecha. Pero ese mismo cliente casi siempre ya está cargado
// en los casos de Contacto con su teléfono, así que se lo busca POR DOMINIO (la
// patente), que es el dato que comparten las dos puntas.
//
// La patente está escrita de cualquier forma según de dónde venga ("AB 123 CD",
// "ab123cd", "AB-123-CD"), así que la comparación se hace sobre la patente
// NORMALIZADA (solo letras y números, en mayúscula) de los dos lados. La cuenta
// la hace Postgres, para no traerse todos los casos a memoria.
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

/** La patente sin espacios, guiones ni minúsculas: "ab-123 cd" → "AB123CD". */
export function clavePatente(valor: string | null | undefined): string {
  return (valor ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * El teléfono de cada dominio, sacado de los casos de Contacto. Devuelve un mapa
 * con la patente normalizada como clave; los dominios sin caso no aparecen.
 *
 * Si un mismo auto tiene varios casos (vuelve al taller), gana el más reciente:
 * es el teléfono con el que se lo contactó la última vez.
 */
export async function telefonosPorDominio(
  dominios: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const claves = [...new Set(dominios.map(clavePatente).filter((c) => c !== ""))];
  const telefonos = new Map<string, string>();
  if (claves.length === 0) return telefonos;

  const filas = await prisma.$queryRaw<Array<{ clave: string; whatsapp: string; celular: string }>>(Prisma.sql`
    SELECT regexp_replace(upper(patente), '[^A-Z0-9]', '', 'g') AS clave,
           whatsapp,
           celular
    FROM "Caso"
    WHERE "eliminadoEn" IS NULL
      AND regexp_replace(upper(patente), '[^A-Z0-9]', '', 'g') = ANY(${claves})
    ORDER BY "fechaProgramacion" DESC NULLS LAST
  `);

  // Como vienen del más nuevo al más viejo, el primero que tenga teléfono manda.
  for (const f of filas) {
    if (telefonos.has(f.clave)) continue;
    const telefono = (f.whatsapp || f.celular || "").trim();
    if (telefono) telefonos.set(f.clave, telefono);
  }
  return telefonos;
}
