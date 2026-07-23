// Datos de ejemplo para DEMOSTRACIONES. Crea una carga y 6-8 casos ficticios
// (nombres/modelos/sucursales inventados, NUNCA datos de clientes reales),
// variados en estado de contacto, para poder mostrar el sistema sin depender de
// haber cargado el Excel real justo antes de la reunión.
//
// Correr con:  npx tsx src/scripts/seed-demo.ts
// Es idempotente: borra el set de demo anterior (por el nombre de archivo marcador)
// y lo vuelve a crear. Solo toca los datos de demo, no los reales.

import { EstadoContacto, OrigenAgendamiento, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FILENAME_DEMO = "DEMO — datos de ejemplo (seed-demo.ts)";
const SUCURSAL = "San Juan Centro";
const PERIODO = new Date().toISOString().slice(0, 7); // AAAA-MM del mes actual

function diasAtras(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

// 8 casos ficticios, variados en estado. Los ENVIADO son los que sirven para
// "Simular respuesta del cliente" en la demo.
const CASOS = [
  { orden: "DEMO-1001", nombre: "Lucía Fernández", email: "lucia.fernandez@gmail.com", modelo: "Ford Ranger", patente: "AF123BC", asesor: "Diego Roldán", origen: OrigenAgendamiento.DEALER, estado: EstadoContacto.ENVIADO, dias: 2 },
  { orden: "DEMO-1002", nombre: "Martín Gómez", email: "martin.gomez@hotmail.com", modelo: "Ford Focus", patente: "AD456GH", asesor: "Paula Ibáñez", origen: OrigenAgendamiento.FORDPASS, estado: EstadoContacto.ENVIADO, dias: 3 },
  { orden: "DEMO-1003", nombre: "Sofía Ramírez", email: "sofia.ramirez@gmail.com", modelo: "Ford EcoSport", patente: "AC789JK", asesor: "Diego Roldán", origen: OrigenAgendamiento.ONLINEBOOKING, estado: EstadoContacto.ENVIADO, dias: 1 },
  { orden: "DEMO-1004", nombre: "Javier Torres", email: "javier.torres@gmail.com", modelo: "Ford Ka", patente: "AB321LM", asesor: "Paula Ibáñez", origen: OrigenAgendamiento.DEALER, estado: EstadoContacto.PENDIENTE, dias: 0 },
  { orden: "DEMO-1005", nombre: "Carla Sosa", email: "carla.sosa@gmail.com", modelo: "Ford Territory", patente: "AF654NP", asesor: "Marcos Díaz", origen: OrigenAgendamiento.FORDPASS, estado: EstadoContacto.RESPONDIDO, dias: 6 },
  { orden: "DEMO-1006", nombre: "Nicolás Herrera", email: "nherrera@gmail.com", modelo: "Ford Ranger", patente: "AD987QR", asesor: "Marcos Díaz", origen: OrigenAgendamiento.DEALER, estado: EstadoContacto.NO_RESPONDIO, dias: 9 },
  // DEMO-1007 a propósito SIN email, para probar la redacción alternativa del agradecimiento
  { orden: "DEMO-1007", nombre: "Valentina Ruiz", email: null, modelo: "Ford Bronco Sport", patente: "AF741ST", asesor: "Paula Ibáñez", origen: OrigenAgendamiento.ONLINEBOOKING, estado: EstadoContacto.ENVIADO, dias: 4 },
  { orden: "DEMO-1008", nombre: "Taller interno", email: null, modelo: "Ford Transit", patente: "AC258UV", asesor: "Marcos Díaz", origen: OrigenAgendamiento.OTRO, estado: EstadoContacto.INTERNO, dias: 5 },
];

// Teléfono ficticio E.164 argentino, distinto por caso (no corresponde a nadie real)
function telefonoDemo(i: number): string {
  return `+5492644${String(100000 + i).slice(-6)}`;
}

async function main() {
  // 1) Borrar el set de demo anterior (cascade elimina sus casos)
  const borrados = await prisma.excelUpload.deleteMany({ where: { filename: FILENAME_DEMO } });
  if (borrados.count > 0) {
    console.log(`[seed-demo] borrada ${borrados.count} carga(s) de demo anterior(es)`);
  }

  // 2) Crear la carga contenedora
  const upload = await prisma.excelUpload.create({
    data: {
      filename: FILENAME_DEMO,
      sucursal: SUCURSAL,
      periodo: PERIODO,
      uploadedBy: "seed-demo",
      columnMapping: {},
      totalRows: CASOS.length,
    },
  });

  // 3) Crear los casos
  await prisma.caso.createMany({
    data: CASOS.map((c, i) => ({
      uploadId: upload.id,
      numeroOrden: c.orden,
      fechaProgramacion: diasAtras(c.dias + 1),
      hora: "09:30",
      origenAgendamiento: c.origen,
      asesor: c.asesor,
      modelo: c.modelo,
      patente: c.patente,
      nombrePropietario: c.nombre,
      emailPropietario: c.email,
      celular: telefonoDemo(i),
      whatsapp: telefonoDemo(i),
      comentarioAsesor: "Servicio de mantenimiento (dato de ejemplo para demo).",
      fechaSalida: diasAtras(c.dias),
      diasEnServicio: 1,
      sucursal: SUCURSAL,
      estadoContacto: c.estado,
    })),
  });

  const porEstado = CASOS.reduce<Record<string, number>>((acc, c) => {
    acc[c.estado] = (acc[c.estado] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`[seed-demo] listo: ${CASOS.length} casos de ejemplo creados en la sucursal "${SUCURSAL}" (período ${PERIODO}).`);
  console.log("[seed-demo] por estado:", porEstado);
  console.log('[seed-demo] Tip: en /casos, los casos "ENVIADO" tienen el botón "Simular respuesta del cliente" (con MODO_DEMO=true).');
}

main()
  .catch((err) => {
    console.error("[seed-demo] error:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
