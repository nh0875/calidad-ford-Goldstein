// Prueba de las dos reglas que deciden QUE MENSAJE le llega a un cliente real:
//
//   1. aplicarBarreraDeConfianza(): un positivo con poca confianza no se clasifica.
//   2. decidirAgradecimiento():    sin clasificación explícita no sale nada.
//
// Se corre con:
//   cd backend && npx ts-node --compiler-options '{"module":"commonjs"}' probar-agradecimiento.ts
import { Semaforo, Severidad } from "@prisma/client";
import { decidirAgradecimiento } from "./src/services/analisis.service";
import { CONFIANZA_MINIMA_POSITIVO, ResultadoAnalisis, aplicarBarreraDeConfianza } from "./src/services/sentiment.service";

let ok = 0;
let mal = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (cond) {
    ok++;
    console.log(`  OK    ${nombre}`);
  } else {
    mal++;
    console.log(`  FALLA ${nombre}   -> ${detalle}`);
  }
}

function analisis(semaforo: Semaforo | null, confianza: number, severidad: Severidad | null = null): ResultadoAnalisis {
  return {
    semaforo,
    severidad,
    estrellas: null,
    confianza,
    categoriaCausaRaiz: null,
    resumen: "resumen de la IA",
    requiereRQR: false,
    requiereRevisionManual: false,
    respuestaCruda: {},
  };
}

console.log(`=== BARRERA DE CONFIANZA (minimo ${Math.round(CONFIANZA_MINIMA_POSITIVO * 100)}% para lo positivo) ===`);

for (const [pct, deberiaPasar] of [[100, true], [95, true], [80, true], [79, false], [70, false], [50, false], [25, false]] as Array<[number, boolean]>) {
  const r = aplicarBarreraDeConfianza(analisis(Semaforo.VERDE, pct / 100));
  const paso = r.semaforo === Semaforo.VERDE;
  check(
    `verde con ${pct}% ${deberiaPasar ? "se clasifica" : "queda para revisar"}`,
    paso === deberiaPasar,
    `semaforo=${r.semaforo} revisionManual=${r.requiereRevisionManual}`
  );
}

const bajo = aplicarBarreraDeConfianza(analisis(Semaforo.VERDE, 0.6));
check("al bajar, pide revision manual", bajo.requiereRevisionManual === true, String(bajo.requiereRevisionManual));
check("al bajar, no deja estrellas", bajo.estrellas === null, String(bajo.estrellas));
check("al bajar, no abre RQR", bajo.requiereRQR === false, String(bajo.requiereRQR));
check("al bajar, conserva lo que entendio la IA", bajo.resumen.includes("resumen de la IA"), bajo.resumen);
check("al bajar, dice el porcentaje", bajo.resumen.includes("60%"), bajo.resumen);

console.log("");
console.log("=== LAS QUEJAS NO PASAN POR LA BARRERA (escalar de mas se corrige; pedir 5 puntos a un enojado no) ===");
for (const [s, sev] of [[Semaforo.ROJO, Severidad.GRAVE], [Semaforo.AMARILLO, Severidad.LEVE]] as Array<[Semaforo, Severidad]>) {
  for (const pct of [90, 40]) {
    const r = aplicarBarreraDeConfianza(analisis(s, pct / 100, sev));
    check(`${s.toLowerCase()} con ${pct}% se clasifica igual`, r.semaforo === s, `quedo ${r.semaforo}`);
  }
}

console.log("");
console.log("=== QUE MENSAJE AUTOMATICO SALE ===");
const casos: Array<{ n: string; semaforo: Semaforo | null; revision: boolean; espera: string }> = [
  { n: "verde confirmado", semaforo: Semaforo.VERDE, revision: false, espera: "PROMOTOR" },
  { n: "verde sin confirmar (EL BUG)", semaforo: Semaforo.VERDE, revision: true, espera: "nada" },
  { n: "sin clasificar (EL BUG)", semaforo: null, revision: false, espera: "nada" },
  { n: "sin clasificar + para revisar", semaforo: null, revision: true, espera: "nada" },
  { n: "amarillo", semaforo: Semaforo.AMARILLO, revision: false, espera: "EMPATICO" },
  { n: "amarillo para revisar", semaforo: Semaforo.AMARILLO, revision: true, espera: "EMPATICO" },
  { n: "rojo", semaforo: Semaforo.ROJO, revision: false, espera: "EMPATICO" },
  { n: "rojo para revisar", semaforo: Semaforo.ROJO, revision: true, espera: "EMPATICO" },
];
for (const c of casos) {
  const d = decidirAgradecimiento({ semaforo: c.semaforo, requiereRevisionManual: c.revision });
  const real = d.enviar ? d.tono : "nada";
  check(`${c.n.padEnd(30)} -> ${c.espera}`, real === c.espera, `salio ${real}`);
}

console.log("");
console.log("=== LA CADENA COMPLETA: barrera + mensaje ===");
for (const [pct, esperaMensaje] of [[95, "PROMOTOR"], [79, "nada"]] as Array<[number, string]>) {
  const r = aplicarBarreraDeConfianza(analisis(Semaforo.VERDE, pct / 100));
  const d = decidirAgradecimiento({ semaforo: r.semaforo, requiereRevisionManual: r.requiereRevisionManual });
  const real = d.enviar ? d.tono : "nada";
  check(`la IA dice conforme con ${pct}% -> ${esperaMensaje}`, real === esperaMensaje, `salio ${real}`);
}

console.log("");
console.log(`  ${ok} bien / ${mal} mal`);
process.exit(mal === 0 ? 0 : 1);
