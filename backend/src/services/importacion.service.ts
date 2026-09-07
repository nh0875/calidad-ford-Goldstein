import {
  AreaTrabajo,
  EstadoContacto,
  OrigenAgendamiento,
  Prisma,
  Semaforo,
  TipoAlias,
  TipoAviso,
  TipoUpload,
} from "@prisma/client";
import { marca } from "../config/marca";
import { prisma } from "../config/prisma";
import { olvidarSucursalesConocidas } from "./area.service";
import { crearAviso } from "./aviso.service";
import {
  CampoCaso,
  HojaParseada,
  abrirWorkbook,
  derivarPeriodo,
  derivarPeriodoDeFilas,
  normalizarTexto,
  parsearEntero,
  parsearFecha,
  parsearHoja,
  parsearNota,
} from "./excel.service";
import { normalizarTelefonoAR } from "./telefono.service";
import {
  AliasCanonico,
  aplicarAlias,
  cargarAliasMap,
  claveNormalizada,
  parsearAsesor,
  parsearSucursal,
} from "./normalizacion.service";
import { estaSuprimido, telefonosSuprimidos } from "./supresion.service";

// Datos precargados una vez por importación (alias declarados + supresión +
// mapa nombre→código para propagar el código de asesor conocido).
interface ContextoImportacion {
  aliasAsesor: Map<string, AliasCanonico>;
  aliasSucursal: Map<string, AliasCanonico>;
  suprimidos: Set<string>;
  codigoPorNombre: Map<string, string>;
}

async function cargarCodigoPorNombre(): Promise<Map<string, string>> {
  const conCodigo = await prisma.caso.findMany({
    where: { asesorCodigo: { not: null } },
    select: { asesor: true, asesorCodigo: true },
    distinct: ["asesor", "asesorCodigo"],
  });
  const mapa = new Map<string, string>();
  for (const c of conCodigo) {
    if (c.asesorCodigo) mapa.set(claveNormalizada(c.asesor), c.asesorCodigo);
  }
  return mapa;
}

// ---------- Tipos ----------

export interface HojaAImportar {
  nombre: string;
  mapping: Record<string, CampoCaso>;
  periodo?: string; // "2026-01"; si no viene, se deriva del nombre de la hoja + año
}

export interface ParamsImportacion {
  buffer: Buffer;
  filename: string;
  sucursal: string;
  anio: number;
  uploadedBy: string;
  hojas: HojaAImportar[];
  // Área/tipo de la carga: por defecto Contacto Posventa → POSVENTA. Una carga
  // de Contacto Ventas marca sus casos como VENTAS (mismo formato de Excel).
  tipo?: TipoUpload;
  area?: AreaTrabajo;
}

export interface ErrorFila {
  fila: number; // número de fila del Excel (1-based, como se ve en Excel)
  motivo: string;
}

export interface ResultadoHoja {
  hoja: string;
  periodo: string | null;
  uploadId: string | null;
  ok: boolean;
  mensaje: string;
  totalFilas: number;
  insertados: number;
  duplicados: number;
  // Números de orden que ya existían (en la base o repetidos dentro del mismo
  // archivo) y por eso NO se cargaron. Se listan para avisarle al usuario cuáles
  // están mal, en vez de omitirlos en silencio.
  ordenesDuplicadas: string[];
  errores: ErrorFila[];
  historicosConSentimiento: number;
  semaforo: { VERDE: number; AMARILLO: number; ROJO: number };
  internosExcluidosDeWhatsapp: number;
  // Casos de clientes que ya están en la lista de supresión: se importan igual
  // (no perdemos el dato del servicio) pero nunca entran en una campaña.
  suprimidos: number;
}

// ---------- Mapeo de la columna "Estado" del Excel ----------

export function mapearEstadoContacto(valor: unknown): EstadoContacto {
  const estado = normalizarTexto(valor).toUpperCase();
  switch (estado) {
    case "S":
      return EstadoContacto.RESPONDIDO;
    case "NC":
      return EstadoContacto.NO_RESPONDIO;
    case "INT":
      return EstadoContacto.INTERNO;
    case "RQR":
      return EstadoContacto.RESPONDIDO;
    case "":
      return EstadoContacto.PENDIENTE;
    default:
      return EstadoContacto.PENDIENTE;
  }
}

// Resume una lista de órdenes para el mensaje: las primeras y "y N más".
function resumirOrdenes(ordenes: string[], max = 10): string {
  if (ordenes.length <= max) return ordenes.join(", ");
  return `${ordenes.slice(0, max).join(", ")} y ${ordenes.length - max} más`;
}

function mapearOrigenAgendamiento(valor: unknown): OrigenAgendamiento {
  const origen = normalizarTexto(valor).replace(/\s/g, "");
  if (origen === "dealer") return OrigenAgendamiento.DEALER;
  if (origen === "fordpass") return OrigenAgendamiento.FORDPASS;
  if (origen.includes("onlinebooking")) return OrigenAgendamiento.ONLINEBOOKING;
  if (origen === "") return OrigenAgendamiento.DEALER;
  return OrigenAgendamiento.OTRO;
}

// ---------- Clasificación de semáforo para históricos ----------

export function clasificarSemaforoHistorico(params: {
  estadoExcel: string;
  notas: Array<number | null>;
}): Semaforo {
  if (params.estadoExcel === "RQR") return Semaforo.ROJO;
  const validas = params.notas.filter((n): n is number => n !== null);
  if (validas.length === 0) {
    // Estado "S" con comentario pero sin encuestas: se asume satisfecho
    return Semaforo.VERDE;
  }
  const promedio = validas.reduce((a, b) => a + b, 0) / validas.length;
  if (promedio < 3) return Semaforo.ROJO;
  if (promedio <= 4) return Semaforo.AMARILLO;
  return Semaforo.VERDE;
}

// ---------- Importación ----------

// numeroOrden NO es obligatorio: en el Excel real la columna ORDEN recién
// aparece a partir de abril; sin orden, los duplicados se detectan por
// patente + fecha de programación.
const CAMPOS_OBLIGATORIOS: Array<{ campo: CampoCaso; descripcion: string }> = [
  { campo: "nombrePropietario", descripcion: "el nombre del propietario" },
];

function invertirMapping(mapping: Record<string, CampoCaso>): Partial<Record<CampoCaso, string>> {
  const porCampo: Partial<Record<CampoCaso, string>> = {};
  for (const [columna, campo] of Object.entries(mapping)) {
    if (campo !== "descartar" && !(campo in porCampo)) porCampo[campo] = columna;
  }
  return porCampo;
}

function validarMapping(mapping: Record<string, CampoCaso>): string | null {
  const porCampo = invertirMapping(mapping);
  const faltantes = CAMPOS_OBLIGATORIOS.filter(({ campo }) => !porCampo[campo]).map(
    ({ descripcion }) => descripcion
  );
  if (!porCampo.whatsapp && !porCampo.celular) {
    faltantes.push("al menos una columna de teléfono (Whatsapp o Celular)");
  }
  if (faltantes.length > 0) {
    return `Falta indicar qué columna del Excel corresponde a: ${faltantes.join(", ")}. Revisá el mapeo de columnas.`;
  }
  return null;
}

export async function importarHojas(params: ParamsImportacion): Promise<{
  resultados: ResultadoHoja[];
  totales: {
    hojasImportadas: number;
    totalFilas: number;
    insertados: number;
    duplicados: number;
    conError: number;
    ordenesDuplicadas: string[];
    historicosConSentimiento: number;
    semaforo: { VERDE: number; AMARILLO: number; ROJO: number };
    suprimidos: number;
  };
}> {
  const workbook = abrirWorkbook(params.buffer);
  const resultados: ResultadoHoja[] = [];

  // Se cargan una sola vez para toda la importación (alias + supresión).
  const ctx: ContextoImportacion = {
    aliasAsesor: await cargarAliasMap(TipoAlias.ASESOR),
    aliasSucursal: await cargarAliasMap(TipoAlias.SUCURSAL),
    suprimidos: await telefonosSuprimidos(),
    codigoPorNombre: await cargarCodigoPorNombre(),
  };

  for (const hoja of params.hojas) {
    resultados.push(await importarHoja(workbook, hoja, params, ctx));
  }

  const totales = {
    hojasImportadas: resultados.filter((r) => r.ok).length,
    totalFilas: resultados.reduce((a, r) => a + r.totalFilas, 0),
    insertados: resultados.reduce((a, r) => a + r.insertados, 0),
    duplicados: resultados.reduce((a, r) => a + r.duplicados, 0),
    conError: resultados.reduce((a, r) => a + r.errores.length, 0),
    ordenesDuplicadas: resultados.flatMap((r) => r.ordenesDuplicadas),
    historicosConSentimiento: resultados.reduce((a, r) => a + r.historicosConSentimiento, 0),
    semaforo: {
      VERDE: resultados.reduce((a, r) => a + r.semaforo.VERDE, 0),
      AMARILLO: resultados.reduce((a, r) => a + r.semaforo.AMARILLO, 0),
      ROJO: resultados.reduce((a, r) => a + r.semaforo.ROJO, 0),
    },
    suprimidos: resultados.reduce((a, r) => a + r.suprimidos, 0),
  };

  return { resultados, totales };
}

async function importarHoja(
  workbook: import("xlsx").WorkBook,
  hoja: HojaAImportar,
  params: ParamsImportacion,
  ctx: ContextoImportacion
): Promise<ResultadoHoja> {
  const base: ResultadoHoja = {
    hoja: hoja.nombre,
    periodo: null,
    uploadId: null,
    ok: false,
    mensaje: "",
    totalFilas: 0,
    insertados: 0,
    duplicados: 0,
    ordenesDuplicadas: [],
    errores: [],
    historicosConSentimiento: 0,
    semaforo: { VERDE: 0, AMARILLO: 0, ROJO: 0 },
    internosExcluidosDeWhatsapp: 0,
    suprimidos: 0,
  };

  // La sucursal es única para toda la carga: se normaliza una sola vez.
  const sucursalNorm = aplicarAlias(parsearSucursal(params.sucursal), ctx.aliasSucursal);

  const errorMapping = validarMapping(hoja.mapping);
  if (errorMapping) {
    base.mensaje = `Hoja "${hoja.nombre}": ${errorMapping}`;
    return base;
  }

  const parseada = parsearHoja(workbook, hoja.nombre);
  if ("error" in parseada) {
    base.mensaje = parseada.error;
    return base;
  }

  base.totalFilas = parseada.filas.length;

  // Período: explícito > nombre de la hoja ("ENERO" + 2026 -> "2026-01") > mes
  // más frecuente de las fechas de los datos (para hojas sin mes en el nombre,
  // como la única hoja "Normal" del reporte real).
  const periodo =
    hoja.periodo ??
    derivarPeriodo(hoja.nombre, params.anio) ??
    derivarPeriodoDeFilas(parseada.filas, hoja.mapping);
  if (!periodo) {
    base.mensaje =
      `No se pudo deducir el mes de la hoja "${hoja.nombre}" (ni por el nombre ni por las fechas). ` +
      `Indicá el período a mano (formato AAAA-MM, por ejemplo 2026-03) y volvé a intentar.`;
    return base;
  }
  base.periodo = periodo;
  const porCampo = invertirMapping(hoja.mapping);
  const valorDe = (fila: Record<string, unknown>, campo: CampoCaso): unknown => {
    const columna = porCampo[campo];
    return columna ? fila[columna] : null;
  };
  const textoDe = (fila: Record<string, unknown>, campo: CampoCaso): string => {
    const v = valorDe(fila, campo);
    return v === null || v === undefined ? "" : String(v).trim();
  };

  // El número de orden es único en TODO el sistema (una orden = un caso): una
  // orden repetida no se carga, venga del mismo archivo o de otra sucursal/mes.
  // Se precargan todas las órdenes activas de la base (no solo las de esta
  // sucursal+período) para detectar el choque global.
  const ordenesActivas = await prisma.caso.findMany({
    where: { eliminadoEn: null, numeroOrden: { notIn: ["S/N", ""] } },
    select: { numeroOrden: true },
  });
  const ordenesGlobales = new Set(ordenesActivas.map((c) => c.numeroOrden));

  // ---- Detección de posibles duplicados (mismo auto, otra orden) ----
  //
  // El número de orden es único, así que dos cargas del MISMO auto con órdenes
  // distintas entran las dos como casos legítimos y el cliente termina
  // recibiendo dos encuestas por lo mismo. A veces son dos visitas de verdad y a
  // veces es un error de carga: no se puede decidir solo, así que se avisa.
  //
  // Se indexa por chasis y por patente, que son los identificadores duros del
  // vehículo. Es una consulta más al importar, igual que la de órdenes.
  const conIdentificador = await prisma.caso.findMany({
    where: {
      eliminadoEn: null,
      OR: [{ chasisVIN: { not: null } }, { patente: { not: "" } }],
    },
    select: { id: true, numeroOrden: true, chasisVIN: true, patente: true, nombrePropietario: true },
  });

  interface CasoConocido {
    numeroOrden: string;
    nombrePropietario: string;
  }
  const porChasis = new Map<string, CasoConocido>();
  const porPatente = new Map<string, CasoConocido>();
  for (const c of conIdentificador) {
    const datos = { numeroOrden: c.numeroOrden, nombrePropietario: c.nombrePropietario };
    const vin = claveNormalizada(c.chasisVIN ?? "");
    if (vin) porChasis.set(vin, datos);
    const pat = claveNormalizada(c.patente);
    if (pat) porPatente.set(pat, datos);
  }

  /**
   * ¿Este auto ya está cargado con OTRO número de orden? Devuelve con qué choca,
   * o null. Se exige que las DOS tengan orden real: "S/N" contra una orden no es
   * el caso que se pidió detectar, y además ya lo cubre el dedupe patente+fecha.
   */
  const chocaConOtraOrden = (
    vin: string,
    patente: string,
    ordenNueva: string
  ): { con: CasoConocido; por: string } | null => {
    // Solo la marca que lo pidió. En Ford el cartel no aparece.
    if (!marca.avisoPosibleDuplicado) return null;
    if (!ordenNueva) return null;
    const vinKey = claveNormalizada(vin);
    const patKey = claveNormalizada(patente);
    const previo = (vinKey && porChasis.get(vinKey)) || (patKey && porPatente.get(patKey)) || null;
    if (!previo || !previo.numeroOrden || previo.numeroOrden === "S/N") return null;
    if (previo.numeroOrden === ordenNueva) return null;
    return { con: previo, por: vinKey && porChasis.has(vinKey) ? "chasis" : "patente" };
  };

  // Claves para las filas SIN orden (Excel viejo sin columna ORDEN): patente+fecha
  // (un mismo vehículo puede tener dos órdenes distintas el mismo día, por eso
  // solo aplica sin orden); nombre+fecha es el último recurso. Se acota a la
  // sucursal+período, como antes.
  // Se filtra por la sucursal NORMALIZADA (la misma con la que se guardan los
  // casos), si no el dedup patente+fecha no encontraría los casos previos.
  const sucursalGuardada = sucursalNorm.nombre || params.sucursal;
  const casosPrevios = await prisma.caso.findMany({
    where: { sucursal: sucursalGuardada, upload: { periodo }, eliminadoEn: null },
    select: { patente: true, fechaProgramacion: true, nombrePropietario: true },
  });
  const fechaISO = (fecha: Date) => fecha.toISOString().slice(0, 10);
  const clavesExistentes = new Set<string>();
  const registrarClaves = (patente: string, nombre: string, fecha: Date) => {
    if (patente) clavesExistentes.add(`pf:${patente.toUpperCase()}|${fechaISO(fecha)}`);
    if (!patente && nombre) clavesExistentes.add(`nf:${nombre.toUpperCase()}|${fechaISO(fecha)}`);
  };
  for (const c of casosPrevios) {
    registrarClaves(c.patente, c.nombrePropietario, c.fechaProgramacion);
  }

  const upload = await prisma.excelUpload.create({
    data: {
      tipo: params.tipo ?? TipoUpload.CONTACTO_POSVENTA,
      filename: params.filename,
      sucursal: params.sucursal,
      periodo,
      uploadedBy: params.uploadedBy,
      columnMapping: hoja.mapping as Prisma.InputJsonValue,
      kpiResumen: parseada.kpisResumen as Prisma.InputJsonValue,
      totalRows: parseada.filas.length,
      status: "PROCESANDO",
    },
  });
  base.uploadId = upload.id;

  // ---- Guardado por lotes ----
  //
  // Antes se hacía un INSERT por fila, esperando cada uno antes de armar el
  // siguiente: para un archivo de 578 filas eran 578 viajes de ida y vuelta a
  // Postgres, en fila india. Toda la lógica de cada fila (validación, dedupe,
  // alias del asesor) SIGUE siendo secuencial porque muta estado compartido; lo
  // único que se paralela son las escrituras, de a lotes chicos.
  //
  // El lote se mantiene chico a propósito: el pool de conexiones de Prisma no es
  // grande, y esto corre en la PC de la agencia, no en un servidor.
  const TAMANO_LOTE = 25;
  const pendientes: Array<{
    data: Prisma.CasoCreateArgs["data"];
    tieneOrden: boolean;
    numeroOrden: string;
    /** Si este auto ya estaba cargado con otra orden, con qué choca. */
    sospecha: { con: { numeroOrden: string; nombrePropietario: string }; por: string } | null;
  }> = [];

  const guardarLote = async () => {
    if (pendientes.length === 0) return;
    const lote = pendientes.splice(0, pendientes.length);
    await Promise.all(
      lote.map(async (p) => {
        try {
          const creado = await prisma.caso.create({ data: p.data });
          base.insertados++;

          // Aviso de posible duplicado. Va DESPUÉS de crear porque necesita el id
          // del caso nuevo para que el cartel sea clickeable. crearAviso nunca
          // lanza: si falla, no puede voltear la importación.
          if (p.sospecha) {
            await crearAviso({
              tipo: TipoAviso.POSIBLE_DUPLICADO,
              area: params.area ?? AreaTrabajo.POSVENTA,
              sucursal: sucursalNorm.nombre || params.sucursal,
              casoId: creado.id,
              titulo: `Posible duplicado: ${p.data.nombrePropietario || "cliente sin nombre"}`,
              detalle:
                `Entró la orden ${p.numeroOrden || "S/N"} para un vehículo que ya estaba cargado ` +
                `con la orden ${p.sospecha.con.numeroOrden} (coincide el ${p.sospecha.por}, ` +
                `cliente "${p.sospecha.con.nombrePropietario}"). ` +
                `Pueden ser dos visitas distintas o un error de carga: si es lo segundo, conviene ` +
                `borrar uno de los dos ANTES de que salga el contacto, para no escribirle dos veces ` +
                `al cliente por lo mismo.`,
            });
          }
        } catch (err) {
          // Otra carga concurrente insertó esta orden primero: el índice único la
          // rechaza (P2002). Se trata como duplicado, NO se aborta la importación.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            base.duplicados++;
            if (p.tieneOrden) base.ordenesDuplicadas.push(p.numeroOrden);
          } else {
            throw err;
          }
        }
      })
    );
  };

  try {
    for (const { numeroFilaExcel, datos: fila } of parseada.filas) {

      const nombre = textoDe(fila, "nombrePropietario");
      const whatsappNormalizado = normalizarTelefonoAR(valorDe(fila, "whatsapp"));
      const celularNormalizado = normalizarTelefonoAR(valorDe(fila, "celular"));
      const telefono = whatsappNormalizado ?? celularNormalizado;
      const telefonosNorm = [
        ...new Set([whatsappNormalizado, celularNormalizado].filter((x): x is string => !!x)),
      ];

      // Regla de validación: sin nombre Y sin teléfono la fila no sirve para contactar
      if (!nombre && !telefono) {
        base.errores.push({
          fila: numeroFilaExcel,
          motivo: "La fila no tiene nombre de cliente ni ningún teléfono válido, así que no se puede cargar.",
        });
        continue;
      }

      const numeroOrdenRaw = textoDe(fila, "numeroOrden");
      // "S/N" en la columna Orden = SIN orden (no es una orden real). Si no, la
      // primera fila "S/N" reservaría la clave y las siguientes se descartarían
      // como "orden duplicada" siendo servicios distintos.
      const tieneOrden = !!numeroOrdenRaw && numeroOrdenRaw.toUpperCase() !== "S/N";
      const numeroOrden = tieneOrden ? numeroOrdenRaw : "";

      // La fecha de programación es obligatoria en el modelo; si falta o es
      // ilegible, se usa el día 1 del período para no perder la fila.
      const fechaProgramacion =
        parsearFecha(valorDe(fila, "fechaProgramacion")) ?? new Date(`${periodo}-01T00:00:00`);
      const patente = textoDe(fila, "patente");

      // Fila CON número de orden: la orden es única en todo el sistema. Si ya
      // existe (en la base o repetida antes en este mismo archivo), NO se carga
      // y se avisa cuál es. Detecta el choque global, no solo por sucursal/mes.
      if (tieneOrden) {
        if (ordenesGlobales.has(numeroOrden)) {
          base.duplicados++;
          base.ordenesDuplicadas.push(numeroOrden);
          continue;
        }
        ordenesGlobales.add(numeroOrden);
      } else {
        // Fila SIN orden: se cae al criterio patente+fecha / nombre+fecha,
        // acotado a la sucursal+período.
        const claveDedupe = patente
          ? `pf:${patente.toUpperCase()}|${fechaISO(fechaProgramacion)}`
          : nombre
            ? `nf:${nombre.toUpperCase()}|${fechaISO(fechaProgramacion)}`
            : null;
        if (claveDedupe && clavesExistentes.has(claveDedupe)) {
          base.duplicados++;
          continue;
        }
        registrarClaves(patente, nombre, fechaProgramacion);
      }

      const estadoExcel = normalizarTexto(valorDe(fila, "estado")).toUpperCase();
      const estadoContacto = mapearEstadoContacto(valorDe(fila, "estado"));
      if (estadoContacto === EstadoContacto.INTERNO) base.internosExcluidosDeWhatsapp++;

      // Sentimiento histórico: casos ya resueltos a mano (S o RQR) con encuestas o comentario
      const notas = [
        parsearNota(valorDe(fila, "satisfaccionConcesionario")),
        parsearNota(valorDe(fila, "satisfaccionServicio")),
        parsearNota(valorDe(fila, "satisfaccionFord")),
      ];
      const comentarioCliente = textoDe(fila, "comentarioCliente");
      const tieneDatosSentimiento = notas.some((n) => n !== null) || comentarioCliente !== "";
      const creaHistorico = (estadoExcel === "S" || estadoExcel === "RQR") && tieneDatosSentimiento;

      let analisisHistorico: Prisma.SentimentAnalysisCreateWithoutCasoInput | undefined;
      if (creaHistorico) {
        const semaforo = clasificarSemaforoHistorico({ estadoExcel, notas });
        const notasValidas = notas.filter((n): n is number => n !== null);
        const promedio =
          notasValidas.length > 0
            ? Math.round((notasValidas.reduce((a, b) => a + b, 0) / notasValidas.length) * 100) / 100
            : null;

        const resumenIA = comentarioCliente
          ? `[Comentario histórico importado del Excel, no generado por IA] "${comentarioCliente}"`
          : `[Registro histórico importado del Excel, no generado por IA] Sin comentario del cliente; ` +
            `clasificado según las encuestas de satisfacción (promedio ${promedio ?? "s/d"}).`;

        analisisHistorico = {
          semaforo,
          confianza: 1,
          resumenIA,
          respuestaCrudaIA: {
            origen: "importacion-excel",
            estadoExcel,
            notas: {
              concesionario: notas[0],
              servicio: notas[1],
              ford: notas[2],
            },
            promedio,
            comentario: comentarioCliente || null,
          } as Prisma.InputJsonValue,
          requiereRQR: false, // los históricos ya fueron gestionados a mano en su momento
          esHistoricoImportado: true,
        };

        base.historicosConSentimiento++;
        base.semaforo[semaforo]++;
      }

      // Normalización del asesor: nombre para mostrar/agrupar + código aparte +
      // valor original (raw) para trazabilidad, con alias del ADMIN aplicados.
      const asesorRaw = textoDe(fila, "asesor");
      const asesorNorm = aplicarAlias(parsearAsesor(asesorRaw), ctx.aliasAsesor);
      // Código propio, o el ya conocido para ese nombre (para no fragmentar a la
      // misma persona cuando el código viene solo en algunas filas).
      const asesorCodigo =
        asesorNorm.codigo ?? ctx.codigoPorNombre.get(claveNormalizada(asesorNorm.nombre)) ?? null;
      if (asesorNorm.codigo) ctx.codigoPorNombre.set(claveNormalizada(asesorNorm.nombre), asesorNorm.codigo);

      if (estaSuprimido(telefonosNorm, ctx.suprimidos)) base.suprimidos++;

      // ¿Este auto ya está cargado con OTRA orden? Se resuelve acá, en el pase
      // secuencial, y el aviso se emite después de crear el caso.
      const chasisTexto = textoDe(fila, "chasisVIN");
      const sospecha = chocaConOtraOrden(chasisTexto, patente, numeroOrden);

      // El auto se registra YA, no después de guardarlo: así también se detectan
      // dos filas DEL MISMO ARCHIVO que choquen entre sí.
      if (numeroOrden) {
        const datosNuevo = { numeroOrden, nombrePropietario: nombre };
        const vinNuevo = claveNormalizada(chasisTexto);
        if (vinNuevo) porChasis.set(vinNuevo, datosNuevo);
        const patNuevo = claveNormalizada(patente);
        if (patNuevo) porPatente.set(patNuevo, datosNuevo);
      }

      pendientes.push({
        tieneOrden,
        numeroOrden,
        sospecha,
        data: {
          uploadId: upload.id,
          numeroOrden: numeroOrden || "S/N",
          fechaProgramacion,
          hora: textoDe(fila, "hora") || null,
          origenAgendamiento: mapearOrigenAgendamiento(valorDe(fila, "origenAgendamiento")),
          asesor: asesorNorm.nombre || asesorRaw,
          asesorCodigo,
          asesorRaw: asesorRaw || null,
          modelo: textoDe(fila, "modelo"),
          patente: textoDe(fila, "patente"),
          chasisVIN: textoDe(fila, "chasisVIN") || null,
          nombrePropietario: nombre,
          emailPropietario: textoDe(fila, "emailPropietario") || null,
          celular: celularNormalizado ?? textoDe(fila, "celular"),
          whatsapp: telefono ?? "",
          telefonosNorm,
          comentarioAsesor: textoDe(fila, "comentarioAsesor") || null,
          fechaSalida: parsearFecha(valorDe(fila, "fechaSalida")),
          diasEnServicio: parsearEntero(valorDe(fila, "diasEnServicio")),
          sucursal: sucursalNorm.nombre || params.sucursal,
          sucursalRaw: params.sucursal,
          area: params.area ?? AreaTrabajo.POSVENTA,
          estadoContacto,
          ...(analisisHistorico ? { analisis: { create: analisisHistorico } } : {}),
        },
      });
      if (pendientes.length >= TAMANO_LOTE) await guardarLote();
    }

    // Lo que quedó suelto en el último lote incompleto.
    await guardarLote();

    await prisma.excelUpload.update({
      where: { id: upload.id },
      data: { status: "COMPLETADO" },
    });

    // Una carga puede traer una sucursal que el sistema no conocía. El filtro de
    // provincia la resuelve contra las sucursales que existen en la base y las
    // cachea, así que hay que olvidar el caché o los casos nuevos quedarían
    // invisibles hasta un minuto para los usuarios acotados a esa provincia.
    olvidarSucursalesConocidas();

    base.ok = true;
    const detalleOrdenes =
      base.ordenesDuplicadas.length > 0
        ? ` De esos, ${base.ordenesDuplicadas.length} tienen un número de orden que ya existía y NO se cargaron ` +
          `(órdenes: ${resumirOrdenes(base.ordenesDuplicadas)}).`
        : "";
    base.mensaje =
      `Hoja "${hoja.nombre}" (${periodo}): se cargaron ${base.insertados} casos nuevos. ` +
      `${base.duplicados} ya estaban cargados de antes y se omitieron, y ${base.errores.length} filas no se pudieron cargar.` +
      detalleOrdenes;
  } catch (err) {
    await prisma.excelUpload.update({
      where: { id: upload.id },
      data: { status: "ERROR" },
    });
    base.ok = false;
    base.mensaje =
      `Hoja "${hoja.nombre}": ocurrió un problema inesperado a mitad de la carga. ` +
      `Se cargaron ${base.insertados} casos antes del error. Detalle técnico: ${err instanceof Error ? err.message : String(err)}`;
  }

  return base;
}
