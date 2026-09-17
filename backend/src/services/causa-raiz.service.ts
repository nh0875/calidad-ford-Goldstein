// ---------------------------------------------------------------------------
// La causa raíz de un RQR
// ---------------------------------------------------------------------------
//
// Las causas las declara el perfil de la marca (config/marca.ts), porque Calidad
// de Ford y Calidad de Volkswagen nombran distinto por qué falló algo. Acá viven
// las dos cosas que hacen falta para que esa lista sea de verdad cerrada:
//
//   1. El validador que usan los endpoints. Las pantallas ofrecen un
//      desplegable, pero el pedido HTTP se puede armar a mano, y una causa
//      inventada aparecería en los reportes como una categoría más que no se
//      puede ni filtrar ni corregir desde ninguna pantalla.
//
//   2. La limpieza de lo que quedó de una lista anterior.

import { z } from "zod";
import { causasRaizValidas, esCausaRaizValida, marca } from "../config/marca";
import { prisma } from "../config/prisma";

/**
 * Cómo se nombra un RQR al que todavía le falta la causa raíz.
 *
 * NO es una categoría: es una tarea pendiente. Se llama así y no "(sin
 * categoría)" porque eso último se leía como una clasificación más —una opción
 * válida donde dejar el RQR— y un RQR sin causa no sirve para nada: no entra en
 * el reporte de causas, que es lo único que dice dónde está fallando el proceso.
 *
 * Aparece solo en dos lugares: los RQR viejos que quedaron sin causa al cambiar
 * la lista, y los que abre la IA cuando no logra identificarla. En los dos casos
 * hay que completarla a mano, y el sistema no deja cerrarlos así.
 */
export const FALTA_CLASIFICAR = "Falta clasificar";

/** Causa raíz válida en ESTA marca. */
export const zCausaRaiz = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    if (!esCausaRaizValida(v)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Esa causa raíz no existe en ${marca.nombre}.`,
      });
    }
  });

/**
 * Las causas raíz de un RQR: una o varias, todas de ESTA marca, sin repetir.
 *
 * VARIAS desde el 17-09-2026 (pedido del dueño, las dos marcas): un mismo reclamo
 * puede tener más de una causa, todas valen igual y en los reportes el RQR suma en
 * cada una. Al menos una: un RQR sin causa no enseña nada (ver FALTA_CLASIFICAR).
 */
export const zCausasRaiz = z
  .array(zCausaRaiz)
  .min(1, "Indicá al menos una causa raíz.")
  .transform((lista) => [...new Set(lista)]);

/** Las etiquetas de una lista de causas, para textos ("Demora, Trato inadecuado"). */
export function etiquetasCausasRaiz(codigos: string[]): string {
  return codigos.map((c) => marca.causasRaiz.find((x) => x.codigo === c)?.etiqueta ?? c).join(", ");
}

/**
 * Saca de las listas las causas raíz que ya no están en la lista de la marca.
 *
 * POR QUÉ EXISTE. En septiembre de 2026 Calidad de Volkswagen reemplazó su lista
 * entera: las siete de antes (demora, mal trato, precio, calidad, comunicación,
 * repuestos, otro) por diez nuevas que miran el proceso y no el síntoma. Los RQR
 * ya cargados quedaban clasificados con categorías que ninguna pantalla podía
 * mostrar ni ofrecer: se veían con el código crudo, no se podían filtrar y no se
 * podían corregir. El pedido fue explícito: que queden VACÍOS, para volver a
 * clasificarlos con las nuevas.
 *
 * POR QUÉ NO ES UNA MIGRACIÓN. Las migraciones corren igual en las dos marcas y
 * cada una tiene su propia base. Un UPDATE a secas le borraría a Ford unas
 * causas que en Ford siguen siendo válidas. La regla que sí es correcta en las
 * dos —y la que aplica esto— es "borrá lo que no esté en la lista de ESTA
 * marca": en Ford no toca nada, porque ahí no cambió nada.
 *
 * Corre en cada arranque y es idempotente: después de la primera vez encuentra
 * cero. Además deja el sistema a salvo de la próxima vez que se cambie la lista.
 *
 * SOLO SACA LAS INVÁLIDAS de cada lista: las otras causas del mismo RQR quedan. No
 * borra RQR ni análisis: lo que se pierde es la clasificación, no el caso ni lo que
 * dijo el cliente.
 */
export async function limpiarCausasRaizFueraDeLista(): Promise<void> {
  const validas = causasRaizValidas();

  // Antes de sacar, contar qué había. Sin esto la corrida no deja ni rastro de
  // qué se perdió, y "se borraron 240 causas" sin decir de cuáles es un dato que
  // no sirve para nada si después hay que explicarlo.
  const previas = await prisma.$queryRaw<Array<{ codigo: string; cantidad: bigint }>>`
    SELECT c AS codigo, COUNT(*) AS cantidad
    FROM "RQR", unnest("causasRaiz") AS c
    WHERE NOT (c = ANY(${validas}::text[]))
    GROUP BY c`;

  const rqr = await prisma.$executeRaw`
    UPDATE "RQR"
    SET "causasRaiz" = ARRAY(SELECT c FROM unnest("causasRaiz") AS c WHERE c = ANY(${validas}::text[]))
    WHERE NOT ("causasRaiz" <@ ${validas}::text[])`;
  const analisis = await prisma.$executeRaw`
    UPDATE "SentimentAnalysis"
    SET "categoriasCausaRaiz" = ARRAY(SELECT c FROM unnest("categoriasCausaRaiz") AS c WHERE c = ANY(${validas}::text[]))
    WHERE NOT ("categoriasCausaRaiz" <@ ${validas}::text[])`;

  if (rqr === 0 && analisis === 0) return;

  const detalle = previas.map((p) => `${p.codigo} (${Number(p.cantidad)})`).join(", ");
  console.log(
    `[causa-raiz] se sacaron causas que ya no existen en ${marca.nombre} de ${rqr} RQR y ${analisis} análisis.` +
      (detalle ? ` Eran: ${detalle}.` : "") +
      " Los que quedaron sin ninguna hay que volver a clasificarlos desde la pantalla de RQR."
  );
}
