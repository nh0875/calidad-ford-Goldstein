// Lectura de la respuesta a la encuesta de Posventa por ítems.
//
// El cliente contestó las preguntas en un mensaje. Son 5, o 4 cuando al auto no
// le hicieron lavado y por eso no se le preguntó por la limpieza de entrega (ver
// itemsPreguntados en config/posventa-vw.ts). TODO lo de este archivo trabaja
// sobre la lista de ítems que se le preguntaron A ESE CASO, no sobre el catálogo
// completo: si se leyera siempre de a 5, un cliente al que se le hicieron 4
// preguntas y contesta "5 4 5 4" quedaría con el último puntaje corrido de lugar
// —su satisfacción general pasaría a contarse como el lavado que nunca hubo—.
//
// Puede haber contestado de muchas formas:
//
//   "5 4 5 3 4"
//   "5,4,5,3,4 el lavado dejo que desear"
//   "1) 5  2) 4  3) 5  4) 3  5) 4"
//   "todo excelente menos el lavado que vino sucio"
//   "muy buena atencion, el auto quedo perfecto"
//
// Las dos primeras familias se resuelven SIN IA con un parser: son la mayoría,
// son inequívocas, y no tiene sentido gastar una llamada (ni arriesgar que el
// modelo se equivoque) en algo que es literalmente una lista de números.
//
// El resto va a la IA con un prompt propio que devuelve un puntaje por ítem.
import { z } from "zod";
import { marca } from "../config/marca";
import { DEFINICION_ITEMS, ITEMS_POSVENTA, ItemPosventa } from "../config/posventa-vw";
import { PuntajeItem } from "./encuesta-posventa.service";

// ---------------------------------------------------------------------------
// 1. Parser sin IA: "5 4 5 3 4"
// ---------------------------------------------------------------------------

/**
 * Intenta leer los puntajes de una lista de números.
 *
 * `items` son los ítems que se le preguntaron a ESE caso, en orden: son 5, o 4
 * si no hubo lavado. La cantidad importa dos veces —cuántos números se esperan y
 * a qué ítem corresponde cada posición—, y por eso no se usa el catálogo fijo.
 *
 * Devuelve null si el mensaje no es claramente una lista: ante la duda es mejor
 * mandarlo a la IA que inventar puntajes con números que estaban hablando de
 * otra cosa ("me atendieron a las 5 y esperé 40 minutos").
 */
export function leerPuntajesDeLista(
  texto: string,
  items: readonly ItemPosventa[] = ITEMS_POSVENTA
): PuntajeItem[] | null {
  const limpio = texto.trim();
  if (!limpio) return null;
  const N = items.length;
  if (N === 0) return null;

  let valores: number[] | null = null;
  let finUltimo = 0;

  // a) "1) 5  2) 4  3) 5 …": el cliente repite el número de pregunta. Se exige
  //    que los numeradores vayan 1,2,3,4,5 EN ORDEN; si no, es casualidad.
  const pares = [...limpio.matchAll(/(?:^|[\s(])([1-5])\s*[).:\]-]\s*([1-5])(?![\d])/g)];
  if (pares.length === N && pares.every((m, i) => Number(m[1]) === i + 1)) {
    valores = pares.map((m) => Number(m[2]));
    const u = pares[pares.length - 1];
    finUltimo = (u.index ?? 0) + u[0].length;
  }

  if (!valores) {
    // b) Números sueltos. Se toman TOKENS completos de dígitos, no dígitos
    //    sueltos: así "40" no cuenta como un 4 y un 0.
    const tokens = [...limpio.matchAll(/\d+/g)];

    // b1) Todo pegado: "54534".
    if (tokens.length === 1 && new RegExp(`^[1-5]{${N}}$`).test(tokens[0][0])) {
      valores = tokens[0][0].split("").map(Number);
      finUltimo = (tokens[0].index ?? 0) + N;
    } else {
      // b2) Un número de un dígito por pregunta, separados por lo que sea
      //     (espacio, coma, guion, barra). Se exige que NO haya otros números
      //     en el medio.
      const deUnDigito = tokens.filter((t) => /^[1-5]$/.test(t[0]));
      if (deUnDigito.length === N && tokens.length === N) {
        valores = deUnDigito.map((t) => Number(t[0]));
        const u = deUnDigito[deUnDigito.length - 1];
        finUltimo = (u.index ?? 0) + 1;
      }
    }
  }

  if (!valores) return null;

  // Si ANTES del último puntaje hay bastante texto, lo más probable es que esos
  // números estuvieran hablando de otra cosa ("llegué 5 minutos tarde…").
  // Que lo lea la IA: inventar puntajes ensucia el promedio del área.
  const letrasAntes = limpio.slice(0, finUltimo).replace(/[^a-záéíóúñü]/gi, "").length;
  if (letrasAntes > 12) return null;

  const comentario = limpio.slice(finUltimo).replace(/^[\s,.;:)\]-]+/, "").trim() || null;

  return items.map((item, i) => ({
    item: item as ItemPosventa,
    estrellas: valores![i],
    // Un comentario suelto se cuelga del ítem GENERAL: no se sabe de cuál habla.
    comentario: item === "GENERAL" ? comentario : null,
  }));
}

// ---------------------------------------------------------------------------
// 2. Lectura con IA
// ---------------------------------------------------------------------------

export const esquemaItemsIA = z.object({
  puntajes: z.array(
    z.object({
      item: z.enum(ITEMS_POSVENTA),
      // null = el cliente no dijo nada de ese ítem. Es un dato, no un cero.
      estrellas: z.number().int().min(1).max(5).nullable(),
      comentario: z.string().nullable(),
    })
  ),
  confianza: z.number().min(0).max(1),
  resumen: z.string().min(1),
});

/**
 * Los ejemplos del prompt.
 *
 * Van escritos a mano y por separado para cada variante en vez de generarse
 * recortando el de 5: son prosa, y un ejemplo armado por recorte quedaría
 * diciendo "el lavado es lo más flojo" en el caso donde no hubo lavado, que es
 * justo lo que el modelo NO tiene que hacer.
 */
function ejemplosDelPrompt(sinLavado: boolean): string {
  if (sinLavado) {
    return `Cliente: "5 4 5 4"
Salida: {"puntajes":[{"item":"TRATO","estrellas":5,"comentario":null},{"item":"ORGANIZACION","estrellas":4,"comentario":null},{"item":"CALIDAD_REPARACION","estrellas":5,"comentario":null},{"item":"GENERAL","estrellas":4,"comentario":null}],"confianza":0.95,"resumen":"Conforme; la organización es lo más flojo."}

Cliente: "Me atendieron de diez y el auto quedó impecable, pero me hicieron esperar dos horas de más"
Salida: {"puntajes":[{"item":"TRATO","estrellas":5,"comentario":"Me atendieron de diez"},{"item":"ORGANIZACION","estrellas":2,"comentario":"me hicieron esperar dos horas de más"},{"item":"CALIDAD_REPARACION","estrellas":5,"comentario":"el auto quedó impecable"},{"item":"GENERAL","estrellas":4,"comentario":null}],"confianza":0.9,"resumen":"Muy conforme con la atención y la reparación; perdió dos horas esperando."}

Cliente: "Todo bien, gracias"
Salida: {"puntajes":[{"item":"TRATO","estrellas":null,"comentario":null},{"item":"ORGANIZACION","estrellas":null,"comentario":null},{"item":"CALIDAD_REPARACION","estrellas":null,"comentario":null},{"item":"GENERAL","estrellas":4,"comentario":"Todo bien"}],"confianza":0.5,"resumen":"Dice que todo bien, sin detalle de ningún ítem en particular."}

Cliente: "un desastre, tuve que volver tres veces por lo mismo"
Salida: {"puntajes":[{"item":"TRATO","estrellas":null,"comentario":null},{"item":"ORGANIZACION","estrellas":2,"comentario":"tuve que volver tres veces"},{"item":"CALIDAD_REPARACION","estrellas":1,"comentario":"tuve que volver tres veces por lo mismo"},{"item":"GENERAL","estrellas":1,"comentario":"un desastre"}],"confianza":0.9,"resumen":"Problema sin resolver: volvió tres veces por lo mismo."}`;
  }

  return `Cliente: "5 4 5 3 4"
Salida: {"puntajes":[{"item":"TRATO","estrellas":5,"comentario":null},{"item":"ORGANIZACION","estrellas":4,"comentario":null},{"item":"CALIDAD_REPARACION","estrellas":5,"comentario":null},{"item":"LAVADO","estrellas":3,"comentario":null},{"item":"GENERAL","estrellas":4,"comentario":null}],"confianza":0.95,"resumen":"Conforme en general; el lavado es lo más flojo."}

Cliente: "Me atendieron de diez y el auto quedó impecable, pero me lo entregaron sucio por dentro"
Salida: {"puntajes":[{"item":"TRATO","estrellas":5,"comentario":"Me atendieron de diez"},{"item":"ORGANIZACION","estrellas":null,"comentario":null},{"item":"CALIDAD_REPARACION","estrellas":5,"comentario":"el auto quedó impecable"},{"item":"LAVADO","estrellas":2,"comentario":"me lo entregaron sucio por dentro"},{"item":"GENERAL","estrellas":4,"comentario":null}],"confianza":0.9,"resumen":"Muy conforme con la atención y la reparación; el auto se entregó sucio por dentro."}

Cliente: "Todo bien, gracias"
Salida: {"puntajes":[{"item":"TRATO","estrellas":null,"comentario":null},{"item":"ORGANIZACION","estrellas":null,"comentario":null},{"item":"CALIDAD_REPARACION","estrellas":null,"comentario":null},{"item":"LAVADO","estrellas":null,"comentario":null},{"item":"GENERAL","estrellas":4,"comentario":"Todo bien"}],"confianza":0.5,"resumen":"Dice que todo bien, sin detalle de ningún ítem en particular."}

Cliente: "un desastre, tuve que volver tres veces por lo mismo"
Salida: {"puntajes":[{"item":"TRATO","estrellas":null,"comentario":null},{"item":"ORGANIZACION","estrellas":2,"comentario":"tuve que volver tres veces"},{"item":"CALIDAD_REPARACION","estrellas":1,"comentario":"tuve que volver tres veces por lo mismo"},{"item":"LAVADO","estrellas":null,"comentario":null},{"item":"GENERAL","estrellas":1,"comentario":"un desastre"}],"confianza":0.9,"resumen":"Problema sin resolver: volvió tres veces por lo mismo."}`;
}

export function promptItemsPosventa(items: readonly ItemPosventa[] = ITEMS_POSVENTA): string {
  const definiciones = DEFINICION_ITEMS.filter((d) => items.includes(d.item));
  const lista = definiciones.map(
    (d) => `- ${d.item}: ${d.etiqueta}. ${d.descripcion} (se le preguntó: "${d.pregunta}")`
  ).join("\n");
  const sinLavado = !items.includes("LAVADO");
  const N = definiciones.length;

  return `Sos el analista de calidad de una concesionaria ${marca.nombre}. A un cliente que pasó por el taller se le hicieron ${N} preguntas y contestó en UN mensaje. Tu trabajo es sacar el puntaje de CADA ítem por separado.

LOS ${N} ÍTEMS:
${lista}${
    sinLavado
      ? `

OJO: a este cliente NO se le preguntó por el lavado, porque en esta visita al auto no se lo lavaron. NO devuelvas el ítem LAVADO ni aunque el cliente hable de la limpieza por su cuenta; si menciona algo de eso, va en el comentario de GENERAL.`
      : ""
  }

CÓMO PUNTUAR (1 a 5, donde 5 es lo mejor):
- 5: conforme, sin ninguna objeción sobre ESE ítem.
- 4: conforme con una objeción menor, mencionada al pasar.
- 3: satisfacción parcial o una molestia concreta.
- 2: insatisfecho, reclamo claro.
- 1: muy insatisfecho, indignación o problema sin resolver.

REGLA MÁS IMPORTANTE — CADA ÍTEM SE PUNTÚA SOLO:
Un cliente puede estar encantado con la atención y furioso con la espera. NO promedies ni contagies: si dice "me atendieron de diez pero me tuvieron el auto tres días de más", TRATO va 5 y ORGANIZACION va 1 o 2. El sentido de medir por ítem es justamente poder ver eso.

SI NO DIJO NADA DE UN ÍTEM, PONÉ null:
No lo completes por parecido ni por el clima general del mensaje. "Todo bien" NO alcanza para puntuar la reparación si no la mencionó: eso va null. Un null es información honesta ("nadie nos contó del lavado"); un 5 inventado ensucia el promedio del área y hace que un problema real quede tapado.
La ÚNICA excepción es GENERAL: si el cliente da una impresión general clara ("todo excelente", "un desastre"), eso SÍ es la satisfacción general.

SI CONTESTÓ CON NÚMEROS:
Vienen en el orden de la lista de arriba, y son ${N}: el primero es ${definiciones[0]?.item}, el último es ${definiciones[N - 1]?.item}.

COMENTARIO POR ÍTEM:
Si el cliente dijo algo puntual de un ítem, copiá la parte que corresponde en "comentario" (corto, con sus palabras). Si no dijo nada de ese ítem, null. Es lo que convierte un "3" en algo accionable.

EJEMPLOS:

${ejemplosDelPrompt(sinLavado)}

Respondé ÚNICAMENTE con un objeto JSON válido con esta forma exacta, sin texto adicional antes ni después:
{"puntajes":[{"item":${definiciones.map((d) => `"${d.item}"`).join("|")},"estrellas":1|2|3|4|5|null,"comentario":string|null}],"confianza":number,"resumen":string}`;
}

/**
 * Completa los ítems que el modelo no haya devuelto, en el orden del catálogo.
 *
 * Se recorren los ítems QUE SE PREGUNTARON: si el modelo devuelve igual un
 * LAVADO en un caso donde no hubo lavado, acá se cae. Guardarlo sería inventar
 * la medición de un lavado que no existió.
 */
export function normalizarPuntajes(
  crudos: Array<{ item: string; estrellas: number | null; comentario: string | null }>,
  items: readonly ItemPosventa[] = ITEMS_POSVENTA
): PuntajeItem[] {
  return items.map((item) => {
    const encontrado = crudos.find((c) => c.item === item);
    return {
      item: item as ItemPosventa,
      estrellas: encontrado?.estrellas ?? null,
      comentario: encontrado?.comentario ?? null,
    };
  });
}
