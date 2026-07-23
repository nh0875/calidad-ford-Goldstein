// Fixture de PRUEBA para la Parte B (encuesta Ford). Crea casos que matchean
// filas reales del archivo de ejemplo por DISTINTOS criterios (orden, VIN,
// teléfono, email) y 3 usuarios CALIDAD para probar el reparto equitativo.
// Idempotente. Correr: npx tsx src/scripts/seed-ford-test.ts
import { EstadoContacto, PrismaClient } from "@prisma/client";
import { hashPassword } from "../services/auth.service";

const prisma = new PrismaClient();
const FILENAME = "TEST FORD MATCH (seed-ford-test.ts)";

// Casos que deben matchear filas del export real, cada uno por un criterio distinto.
// (orden = numeroOrden; VIN = chasisVIN; tel = whatsapp normalizado; email = emailPropietario)
const CASOS = [
  // 6 Invited → match por ORDEN → tarea RECORDAR_ENCUESTA
  { orden: "86106", nombre: "Stella Olmo", modelo: "Ford Ranger" },
  { orden: "85879", nombre: "Pamela Alfonso", modelo: "Ford Focus" },
  { orden: "86146", nombre: "Viviana Romero", modelo: "Ford EcoSport" },
  { orden: "86179", nombre: "Flavia Martín", modelo: "Ford Ka" },
  { orden: "86168", nombre: "Florencio Bauza", modelo: "Ford Territory" },
  { orden: "86121", nombre: "Javier Berardo", modelo: "Ford Ranger" },
  // Reminded 86019 → match por VIN (orden distinto, no está en el archivo)
  { orden: "TST-VIN-1", vin: "8AFBR00H0SJ490045", nombre: "Rosario Sánchez", modelo: "Ford Bronco Sport" },
  // Completed 86178 (tel 261 5559088) → match por TELÉFONO → RESPONDIDA (sin tarea)
  { orden: "TST-TEL-1", whatsapp: "+5492615559088", nombre: "Gustavo Pérez", modelo: "Ford Kuga" },
  // Bounced 85989 (email) → match por EMAIL → EMAIL_INVALIDO → tarea VERIFICAR_EMAIL
  { orden: "TST-EMAIL-1", email: "ernestocasnovas@gmail.com", nombre: "Manuel Casasnovas", modelo: "Ford Maverick" },
  // Opt out 86043 → match por ORDEN → NO_ELEGIBLE (sin tarea)
  { orden: "86043", nombre: "Félix Delia", modelo: "Ford Ranger" },
  // Quarantine 86155 → match por ORDEN → NO_ELEGIBLE (sin tarea)
  { orden: "86155", nombre: "Francisco Granata", modelo: "Ford Focus" },
];

const USUARIOS = [
  { nombre: "Empleada Uno", email: "empleado1.test@calidad.local" },
  { nombre: "Empleado Dos", email: "empleado2.test@calidad.local" },
  { nombre: "Empleada Tres", email: "empleado3.test@calidad.local" },
];

async function main() {
  await prisma.excelUpload.deleteMany({ where: { filename: FILENAME } });

  const upload = await prisma.excelUpload.create({
    data: { tipo: "CONTACTO_POSVENTA", filename: FILENAME, sucursal: "Goldstein Guaymallén", periodo: "2026-07", uploadedBy: "seed-ford-test", columnMapping: {}, totalRows: CASOS.length },
  });

  let i = 0;
  for (const c of CASOS) {
    i++;
    await prisma.caso.create({
      data: {
        uploadId: upload.id,
        numeroOrden: c.orden,
        fechaProgramacion: new Date("2026-07-15"),
        asesor: "Asesor Test",
        modelo: c.modelo,
        patente: `TST${String(i).padStart(3, "0")}`,
        chasisVIN: (c as { vin?: string }).vin ?? null,
        nombrePropietario: c.nombre,
        emailPropietario: (c as { email?: string }).email ?? null,
        celular: (c as { whatsapp?: string }).whatsapp ?? `+54926440000${i}`,
        whatsapp: (c as { whatsapp?: string }).whatsapp ?? `+54926440000${i}`,
        sucursal: "Goldstein Guaymallén",
        estadoContacto: EstadoContacto.RESPONDIDO,
      },
    });
  }

  const hash = await hashPassword("Test1234!");
  for (const u of USUARIOS) {
    await prisma.usuario.upsert({
      where: { email: u.email },
      create: { nombre: u.nombre, email: u.email, passwordHash: hash, rol: "CALIDAD", participaEnRefuerzos: true },
      update: { activo: true, participaEnRefuerzos: true, rol: "CALIDAD" },
    });
  }

  console.log(`[seed-ford-test] listo: ${CASOS.length} casos + ${USUARIOS.length} usuarios CALIDAD (pass Test1234!).`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
