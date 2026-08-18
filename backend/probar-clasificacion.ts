// Prueba de decidirClasificacion(): qué hace el sistema con cada tipo de
// respuesta del cliente. Se corre con:
//   cd backend && npx ts-node --compiler-options '{"module":"commonjs"}' probar-clasificacion.ts
import { Semaforo } from "@prisma/client";
import { decidirClasificacion } from "./src/services/analisis.service";

type Esperado = "VERDE" | "IA" | "no-textual" | "reaccion-ambigua" | "solo-cortesia";

function resultado(contenidos: string[], esSeguimiento = false): Esperado {
  const d = decidirClasificacion({
    contenidos,
    textoConsolidado: contenidos.length === 1 ? contenidos[0] : contenidos.map((c, i) => `(${i + 1}) ${c}`).join(" "),
    esSeguimiento,
  });
  if (d.revisionManual) return d.revisionManual;
  return d.semaforoEmoji === Semaforo.VERDE ? "VERDE" : "IA";
}

const casos: Array<{ n: string; entrada: string[]; seguimiento?: boolean; espera: Esperado }> = [
  // --- EL BUG REPORTADO ---
  { n: "pulgar arriba solo (RICARDO CASTRO)", entrada: ["\u{1F44D}"], espera: "VERDE" },
  { n: "pulgar con tono de piel", entrada: ["\u{1F44D}\u{1F3FD}"], espera: "VERDE" },
  { n: "pulgar con variation selector", entrada: ["\u{1F44D}\u{FE0F}"], espera: "VERDE" },
  { n: "pulgar con espacios alrededor", entrada: ["  \u{1F44D}  "], espera: "VERDE" },
  { n: "dos pulgares", entrada: ["\u{1F44D}\u{1F44D}"], espera: "VERDE" },
  { n: "varios mensajes de emoji positivo", entrada: ["\u{1F44D}", "\u{1F64F}"], espera: "VERDE" },
  { n: "otros positivos (aplausos)", entrada: ["\u{1F44F}"], espera: "VERDE" },
  { n: "corazon", entrada: ["❤️"], espera: "VERDE" },

  // --- lo que NO se tiene que haber roto ---
  { n: "saludo solo (el bug anterior)", entrada: ["Buen dia"], espera: "solo-cortesia" },
  { n: "saludo con tilde", entrada: ["Buen día"], espera: "solo-cortesia" },
  { n: "hola", entrada: ["Hola"], espera: "solo-cortesia" },
  { n: "gracias solo", entrada: ["Muchas gracias"], espera: "solo-cortesia" },
  { n: "pulgar negativo", entrada: ["\u{1F44E}"], espera: "reaccion-ambigua" },
  { n: "emoji ambiguo", entrada: ["\u{1F62E}"], espera: "reaccion-ambigua" },
  { n: "positivo y negativo mezclados", entrada: ["\u{1F44D}\u{1F44E}"], espera: "reaccion-ambigua" },
  { n: "audio ilegible", entrada: ["[audio sin voz reconocible]"], espera: "no-textual" },
  { n: "sticker", entrada: ["[mensaje de tipo sticker]"], espera: "no-textual" },
  { n: "imagen", entrada: ["[mensaje de tipo image]"], espera: "no-textual" },

  // --- lo que tiene que ir a la IA ---
  { n: "opinion positiva de verdad", entrada: ["Todo excelente, muy amables"], espera: "IA" },
  { n: "queja", entrada: ["Me entregaron el auto sucio y tarde"], espera: "IA" },
  { n: "texto con emoji", entrada: ["Todo perfecto \u{1F44D}"], espera: "IA" },
  { n: "saludo + opinion", entrada: ["Buen dia, estuvo todo muy bien"], espera: "IA" },
  { n: "un no seco", entrada: ["No me atendieron bien"], espera: "IA" },

  // --- seguimientos (el caso ya estaba clasificado) ---
  // El "gracias" posterior lo ataja antes el worker (cortesía posterior). Acá
  // se verifica que la regla de cortesía NO se aplique a un seguimiento, que es
  // lo que la haría pisar una queja posterior.
  { n: "seguimiento: queja posterior va a la IA", entrada: ["Al final me lo entregaron mal"], seguimiento: true, espera: "IA" },
  { n: "seguimiento: pulgar sigue siendo VERDE", entrada: ["\u{1F44D}"], seguimiento: true, espera: "VERDE" },
];

let ok = 0;
let mal = 0;
for (const c of casos) {
  const r = resultado(c.entrada, c.seguimiento ?? false);
  const bien = r === c.espera;
  if (bien) ok++;
  else mal++;
  const etiqueta = bien ? "OK   " : "FALLA";
  const entrada = JSON.stringify(c.entrada).slice(0, 42);
  console.log(`  ${etiqueta} ${c.n.padEnd(38)} ${entrada.padEnd(44)} -> ${r}${bien ? "" : `  (se esperaba ${c.espera})`}`);
}
console.log("");
console.log(`  ${ok} bien / ${mal} mal`);
process.exit(mal === 0 ? 0 : 1);
