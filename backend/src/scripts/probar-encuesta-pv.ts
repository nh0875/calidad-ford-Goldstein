// Prueba de punta a punta de Encuestas de fábrica PV contra una base DESCARTABLE.
//
// NO correr contra una base real: crea y borra casos. Se niega si la base no se
// llama calidad_prueba. Uso (con MARCA=VOLKSWAGEN):
//   DATABASE_URL=postgresql://.../calidad_prueba MARCA=VOLKSWAGEN npx tsx src/scripts/probar-encuesta-pv.ts
import { AreaTrabajo, EstadoEncuestaFabrica } from "@prisma/client";
import { prisma } from "../config/prisma";
import {
  contarPendientesPV,
  esPromotorPV,
  listarPromotoresPV,
  periodoDelServicio,
  seguimientoEncuestasPV,
  sincronizarPromotoresPV,
} from "../services/encuesta-pv.service";

let fallas = 0;
function comprobar(nombre: string, ok: boolean, detalle?: unknown) {
  if (ok) console.log(`  OK    ${nombre}`);
  else {
    fallas++;
    console.log(`  FALLA ${nombre}`, detalle ?? "");
  }
}

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("calidad_prueba")) {
    throw new Error("Esta prueba solo corre contra la base descartable calidad_prueba.");
  }
  if ((process.env.MARCA ?? "").toUpperCase() !== "VOLKSWAGEN") {
    throw new Error("Correr con MARCA=VOLKSWAGEN.");
  }

  await prisma.encuestaFabricaPV.deleteMany();
  await prisma.sentimentAnalysis.deleteMany();
  await prisma.caso.deleteMany();
  await prisma.excelUpload.deleteMany();

  const upload = await prisma.excelUpload.create({
    data: { filename: "prueba.xlsx", sucursal: "Mendoza", periodo: "2026-09", uploadedBy: "prueba", columnMapping: {}, totalRows: 0 },
  });

  let n = 0;
  async function caso(opciones: {
    nombre: string;
    sucursal?: string;
    area?: AreaTrabajo;
    asesor?: string;
    fechaSalida?: Date | null;
    fechaProgramacion?: Date;
    eliminado?: boolean;
  }) {
    n++;
    return prisma.caso.create({
      data: {
        uploadId: upload.id,
        numeroOrden: `OR-${n}`,
        fechaProgramacion: opciones.fechaProgramacion ?? new Date(2026, 8, 3),
        fechaSalida: opciones.fechaSalida === undefined ? new Date(2026, 8, 5) : opciones.fechaSalida,
        asesor: opciones.asesor ?? "Perez Juan",
        modelo: "Amarok",
        patente: `AA${String(n).padStart(3, "0")}BB`,
        nombrePropietario: opciones.nombre,
        celular: "2610000000",
        whatsapp: `54926100000${n}`,
        sucursal: opciones.sucursal ?? "MENDOZA",
        area: opciones.area ?? AreaTrabajo.POSVENTA,
        eliminadoEn: opciones.eliminado ? new Date() : null,
      },
    });
  }
  async function analisis(
    casoId: string,
    estrellas: number | null,
    analyzedAt: Date,
    esSeguimiento = false,
    requiereRevisionManual = false
  ) {
    return prisma.sentimentAnalysis.create({
      data: {
        casoId,
        estrellas,
        confianza: 0.95,
        resumenIA: "prueba",
        respuestaCrudaIA: {},
        analyzedAt,
        esSeguimiento,
        requiereRevisionManual,
      },
    });
  }

  const promotor = await caso({ nombre: "Promotor Mendoza", asesor: "Perez Juan" });
  await analisis(promotor.id, 5, new Date(2026, 8, 6, 10));
  const cuatro = await caso({ nombre: "Cuatro estrellas" });
  await analisis(cuatro.id, 4, new Date(2026, 8, 6, 10));
  const sanJuan = await caso({ nombre: "Promotor San Juan", sucursal: "San Juan" });
  await analisis(sanJuan.id, 5, new Date(2026, 8, 6, 10));
  const ventas = await caso({ nombre: "Promotor Ventas", area: AreaTrabajo.VENTAS });
  await analisis(ventas.id, 5, new Date(2026, 8, 6, 10));
  const borrado = await caso({ nombre: "Promotor borrado", eliminado: true });
  await analisis(borrado.id, 5, new Date(2026, 8, 6, 10));
  // Un 5 viejo tapado por una corrección posterior a 3: no es promotor.
  const corregido = await caso({ nombre: "Corregido a 3" });
  await analisis(corregido.id, 5, new Date(2026, 8, 6, 10));
  await analisis(corregido.id, 3, new Date(2026, 8, 7, 10));
  // Un 5 que solo está en un análisis de SEGUIMIENTO no cuenta.
  const soloSeguimiento = await caso({ nombre: "Solo seguimiento en 5" });
  await analisis(soloSeguimiento.id, 2, new Date(2026, 8, 6, 10));
  await analisis(soloSeguimiento.id, 5, new Date(2026, 8, 7, 10), true);
  // Promotor de agosto, sin fecha de salida y con la apertura a medianoche UTC del 1/8.
  const agosto = await caso({
    nombre: "Promotor agosto",
    asesor: "Gomez Ana",
    fechaSalida: null,
    fechaProgramacion: new Date(Date.UTC(2026, 7, 1, 0, 0, 0)),
  });
  await analisis(agosto.id, 5, new Date(2026, 7, 2, 10));
  // Promotor con la sucursal escrita distinto.
  const escrituraRara = await caso({ nombre: "Promotor mendoza minuscula", sucursal: "mendoza " });
  await analisis(escrituraRara.id, 5, new Date(2026, 8, 8, 10));

  console.log("== 1. sincronización");
  await sincronizarPromotoresPV();
  const filas = await prisma.encuestaFabricaPV.findMany({ include: { caso: { select: { nombrePropietario: true } } } });
  const nombres = filas.map((f) => f.caso.nombrePropietario).sort();
  comprobar(
    "entran solo los promotores de Posventa Mendoza con el principal en 5",
    JSON.stringify(nombres) === JSON.stringify(["Promotor Mendoza", "Promotor agosto", "Promotor mendoza minuscula"].sort()),
    nombres
  );
  comprobar("todos entran pendientes", filas.every((f) => f.estado === EstadoEncuestaFabrica.PENDIENTE));

  await sincronizarPromotoresPV();
  comprobar("sincronizar dos veces no duplica", (await prisma.encuestaFabricaPV.count()) === 3);

  console.log("== 2. lista y mes");
  const lista = await listarPromotoresPV();
  comprobar("resumen: 3 pendientes", lista.resumen.pendientes === 3 && lista.resumen.total === 3, lista.resumen);
  const filaAgosto = lista.data.find((d) => d.caso.nombrePropietario === "Promotor agosto");
  comprobar("mes del servicio: medianoche UTC del 1/8 queda en agosto", filaAgosto?.periodo === "2026-08", filaAgosto?.periodo);
  comprobar("periodoDelServicio con medianoche local del 1/9 -> septiembre", periodoDelServicio(new Date(2026, 8, 1)) === "2026-09");
  comprobar("periodoDelServicio con cierre del DMS 31/8 14:23 -> agosto", periodoDelServicio(new Date(2026, 7, 31, 14, 23, 11)) === "2026-08");
  comprobar("periodoDelServicio con alta manual del 31/8 (mediodía local) -> agosto", periodoDelServicio(new Date("2026-08-31T12:00:00")) === "2026-08");
  comprobar("periodoDelServicio con medianoche UTC del 1/8 -> agosto", periodoDelServicio(new Date(Date.UTC(2026, 7, 1))) === "2026-08");
  comprobar("teléfono del caso en la lista", !!lista.data[0]?.caso.telefono);

  console.log("== 3. estados y seguimiento");
  const filaPromotor = filas.find((f) => f.casoId === promotor.id)!;
  await prisma.encuestaFabricaPV.update({ where: { id: filaPromotor.id }, data: { estado: "AVISADO", animadoEn: new Date() } });
  const filaRara = filas.find((f) => f.casoId === escrituraRara.id)!;
  await prisma.encuestaFabricaPV.update({
    where: { id: filaRara.id },
    data: { estado: "RESPONDIO", animadoEn: new Date(), respondioEn: new Date() },
  });
  const seg = await seguimientoEncuestasPV({ periodo: null });
  const septiembre = seg.meses.find((m) => m.periodo === "2026-09");
  comprobar(
    "septiembre: 2 clientes, 2 animados, 1 respondió, efectividad 50%",
    septiembre?.clientes === 2 && septiembre?.animados === 2 && septiembre?.respondieron === 1 && septiembre?.efectividadAnimacion === 50,
    septiembre
  );
  comprobar("ranking por asesor", seg.vendedores.some((v) => v.nombre === "Perez Juan") && seg.vendedores.some((v) => v.nombre === "Gomez Ana"), seg.vendedores.map((v) => v.nombre));
  comprobar("contador del menú: 1 pendiente", (await contarPendientesPV()) === 1);

  console.log("== 4. dejan de ser promotores");
  // El animado baja a 2: se queda, marcado. El pendiente de agosto baja a 3: sale.
  await analisis(promotor.id, 2, new Date(2026, 8, 9, 10));
  await analisis(agosto.id, 3, new Date(2026, 8, 9, 10));
  const lista2 = await listarPromotoresPV();
  const sigue = lista2.data.find((d) => d.caso.nombrePropietario === "Promotor Mendoza");
  comprobar("el ya animado se queda, marcado como que ya no es 5", !!sigue && sigue.sigueSiendoPromotor === false && sigue.estrellasActuales === 2, sigue);
  comprobar("el pendiente que bajó sale de la lista", !lista2.data.some((d) => d.caso.nombrePropietario === "Promotor agosto"));
  // Un nuevo 5 entra solo, sin reiniciar nada.
  const nuevo = await caso({ nombre: "Promotor nuevo" });
  await analisis(nuevo.id, 5, new Date(2026, 8, 10, 10));
  const lista3 = await listarPromotoresPV();
  comprobar("un 5 nuevo aparece al abrir la pestaña", lista3.data.some((d) => d.caso.nombrePropietario === "Promotor nuevo" && d.estado === "PENDIENTE"));

  console.log("== 5. revisión manual, casos corregidos y vuelta a Pendiente");
  const enRevision = await caso({ nombre: "Cinco en revision" });
  const a5revision = await analisis(enRevision.id, 5, new Date(2026, 8, 11, 10), false, true);
  const lista4 = await listarPromotoresPV();
  comprobar("un 5 que la IA pidió revisar NO entra", !lista4.data.some((d) => d.caso.nombrePropietario === "Cinco en revision"));
  await prisma.sentimentAnalysis.update({ where: { id: a5revision.id }, data: { requiereRevisionManual: false } });
  const lista5 = await listarPromotoresPV();
  comprobar("cuando una persona lo confirma, entra como pendiente", lista5.data.some((d) => d.caso.nombrePropietario === "Cinco en revision" && d.estado === "PENDIENTE"));
  // El respondido de sucursal "mendoza " pasa a San Juan: deja de listarse y de contarse.
  await prisma.caso.update({ where: { id: escrituraRara.id }, data: { sucursal: "San Juan" } });
  const lista6 = await listarPromotoresPV();
  comprobar("un caso corregido a otra sucursal deja de listarse", !lista6.data.some((d) => d.caso.nombrePropietario === "Promotor mendoza minuscula"));
  comprobar("pero su fila se conserva en la base", !!(await prisma.encuestaFabricaPV.findUnique({ where: { casoId: escrituraRara.id } })));
  const seg2 = await seguimientoEncuestasPV({ periodo: null });
  comprobar("y no suma en los gráficos", seg2.total.respondieron === 0, seg2.total);
  comprobar("esPromotorPV: el animado que bajó a 2 ya no es promotor", (await esPromotorPV(promotor.id)) === false);
  comprobar("esPromotorPV: el confirmado sí", (await esPromotorPV(enRevision.id)) === true);

  console.log(fallas === 0 ? "\nTODO BIEN" : `\n${fallas} FALLA(S)`);
  await prisma.$disconnect();
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
