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
 * Borra las causas raíz que ya no están en la lista de la marca.
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
 * SOLO PONE EN NULL. No borra RQR ni análisis: lo que se pierde es la
 * clasificación, no el caso ni lo que dijo el cliente.
 */
export async function limpiarCausasRaizFueraDeLista(): Promise<void> {
  const validas = causasRaizValidas();

  // Antes de borrar, contar qué había. Sin esto la corrida no deja ni rastro de
  // qué se perdió, y "se borraron 240 causas" sin decir de cuáles es un dato que
  // no sirve para nada si después hay que explicarlo.
  const previas = await prisma.rQR.groupBy({
    by: ["causaRaiz"],
    where: { causaRaiz: { notIn: validas } },
    _count: { _all: true },
  });

  const [rqr, analisis] = await prisma.$transaction([
    prisma.rQR.updateMany({
      where: { causaRaiz: { notIn: validas } },
      data: { causaRaiz: null },
    }),
    prisma.sentimentAnalysis.updateMany({
      where: { categoriaCausaRaiz: { notIn: validas } },
      data: { categoriaCausaRaiz: null },
    }),
  ]);

  if (rqr.count === 0 && analisis.count === 0) return;

  const detalle = previas
    .filter((p) => p.causaRaiz)
    .map((p) => `${p.causaRaiz} (${p._count._all})`)
    .join(", ");
  console.log(
    `[causa-raiz] se vaciaron ${rqr.count} RQR y ${analisis.count} análisis que tenían una causa que ya no existe en ${marca.nombre}.` +
      (detalle ? ` Eran: ${detalle}.` : "") +
      " Hay que volver a clasificarlos desde la pantalla de RQR."
  );
}
