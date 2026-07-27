import { AreaTrabajo, EstadoContacto, EstadoRQR, Prisma, Semaforo } from "@prisma/client";
import { prisma } from "../config/prisma";
import { claveAgrupacionAsesor, claveNormalizada } from "./normalizacion.service";

// Filtros comunes a todos los reportes (misma semántica en sentimiento,
// causa raíz y gestión de RQR para que las pantallas sean consistentes)
export interface FiltrosReporte {
  fechaDesde?: string; // AAAA-MM-DD
  fechaHasta?: string;
  sucursal?: string;
  asesor?: string;
  periodo?: string; // AAAA-MM (viene del upload del caso)
  area?: AreaTrabajo | null; // restricción por área (la fija el controller)
}

function rangoFechas(f: FiltrosReporte) {
  return {
    ...(f.fechaDesde ? { gte: new Date(`${f.fechaDesde}T00:00:00`) } : {}),
    ...(f.fechaHasta ? { lte: new Date(`${f.fechaHasta}T23:59:59.999`) } : {}),
  };
}

function whereCaso(f: FiltrosReporte): Prisma.CasoWhereInput {
  return {
    eliminadoEn: null, // los casos borrados lógicamente no cuentan en los reportes
    ...(f.area ? { area: f.area } : {}), // restricción por área (caso)
    ...(f.sucursal ? { sucursal: { equals: f.sucursal, mode: "insensitive" } } : {}),
    ...(f.asesor ? { asesor: { contains: f.asesor, mode: "insensitive" } } : {}),
    ...(f.periodo ? { upload: { periodo: f.periodo } } : {}),
  };
}

function claveDia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

// Lunes de la semana ISO de la fecha, como AAAA-MM-DD
function claveSemana(fecha: Date): string {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const dia = d.getUTCDay() || 7; // domingo=7
  d.setUTCDate(d.getUTCDate() - dia + 1);
  return d.toISOString().slice(0, 10);
}

// ---------- REPORTE 1: Sentimiento ----------

const AGRUPAR_POR_SEMANA_A_PARTIR_DE_DIAS = 60;

export async function reporteSentimiento(f: FiltrosReporte) {
  // Análisis con su caso, excluyendo casos internos
  const analisis = await prisma.sentimentAnalysis.findMany({
    where: {
      // Solo la clasificación que cuenta de cada caso. Los seguimientos (lo que
      // el cliente escribió después) quedan afuera: si no, un cliente que
      // contesta con cinco mensajes valdría como cinco respuestas en los
      // totales y en el ranking del asesor.
      esSeguimiento: false,
      analyzedAt: rangoFechas(f),
      caso: { ...whereCaso(f), estadoContacto: { not: EstadoContacto.INTERNO } },
    },
    select: {
      semaforo: true,
      requiereRevisionManual: true,
      analyzedAt: true,
      caso: { select: { sucursal: true, asesor: true, asesorCodigo: true } },
    },
    orderBy: { analyzedAt: "asc" },
  });

  // Totales por semáforo
  const totales = { VERDE: 0, AMARILLO: 0, ROJO: 0, sinClasificar: 0, revisionManual: 0 };
  for (const a of analisis) {
    if (a.semaforo) totales[a.semaforo]++;
    else totales.sinClasificar++;
    if (a.requiereRevisionManual) totales.revisionManual++;
  }
  const clasificados = totales.VERDE + totales.AMARILLO + totales.ROJO;
  const pct = (n: number) => (clasificados > 0 ? Math.round((n / clasificados) * 1000) / 10 : 0);
  const porcentajes = {
    VERDE: pct(totales.VERDE),
    AMARILLO: pct(totales.AMARILLO),
    ROJO: pct(totales.ROJO),
  };

  // Evolución temporal: por día, o por semana si el rango supera 60 días
  const fechas = analisis.map((a) => a.analyzedAt.getTime());
  const desde = f.fechaDesde ? new Date(`${f.fechaDesde}T00:00:00`) : fechas.length ? new Date(Math.min(...fechas)) : new Date();
  const hasta = f.fechaHasta ? new Date(`${f.fechaHasta}T23:59:59`) : fechas.length ? new Date(Math.max(...fechas)) : new Date();
  const dias = Math.max(0, (hasta.getTime() - desde.getTime()) / 86_400_000);
  const agrupacion: "dia" | "semana" = dias > AGRUPAR_POR_SEMANA_A_PARTIR_DE_DIAS ? "semana" : "dia";
  const clave = agrupacion === "semana" ? claveSemana : claveDia;

  const evolucionMapa = new Map<string, { VERDE: number; AMARILLO: number; ROJO: number }>();
  for (const a of analisis) {
    if (!a.semaforo) continue;
    const k = clave(a.analyzedAt);
    const punto = evolucionMapa.get(k) ?? { VERDE: 0, AMARILLO: 0, ROJO: 0 };
    punto[a.semaforo]++;
    evolucionMapa.set(k, punto);
  }
  const evolucion = [...evolucionMapa.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, valores]) => ({ fecha, ...valores }));

  // Desglose por sucursal y por asesor (con % de rojos para detectar concentración).
  // Se agrupa por una CLAVE normalizada (insensible a acentos/mayúsculas, y por
  // código de asesor cuando existe, para no fragmentar ni mezclar homónimos),
  // pero se MUESTRA el nombre canónico.
  const desglosar = (obtener: (a: (typeof analisis)[number]) => { clave: string; nombre: string }) => {
    const mapa = new Map<string, { nombre: string; VERDE: number; AMARILLO: number; ROJO: number }>();
    for (const a of analisis) {
      if (!a.semaforo) continue;
      const { clave, nombre } = obtener(a);
      const k = clave || "(sin dato)";
      const fila = mapa.get(k) ?? { nombre: nombre || "(sin dato)", VERDE: 0, AMARILLO: 0, ROJO: 0 };
      fila[a.semaforo]++;
      mapa.set(k, fila);
    }
    return [...mapa.values()]
      .map((v) => {
        const total = v.VERDE + v.AMARILLO + v.ROJO;
        return {
          nombre: v.nombre,
          VERDE: v.VERDE,
          AMARILLO: v.AMARILLO,
          ROJO: v.ROJO,
          total,
          pctRojos: total > 0 ? Math.round((v.ROJO / total) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.pctRojos - a.pctRojos);
  };

  // Tasa de respuesta sobre los casos contactados (excluye PENDIENTE;
  // los INTERNO se reportan aparte pero no cuentan como contactables)
  const casosPorEstado = await prisma.caso.groupBy({
    by: ["estadoContacto"],
    where: { ...whereCaso(f), fechaProgramacion: rangoFechas(f) },
    _count: { _all: true },
  });
  const conteoEstados: Record<string, number> = {};
  for (const g of casosPorEstado) conteoEstados[g.estadoContacto] = g._count._all;
  const contactados =
    (conteoEstados.RESPONDIDO ?? 0) + (conteoEstados.NO_RESPONDIO ?? 0) + (conteoEstados.ENVIADO ?? 0) + (conteoEstados.ERROR ?? 0);
  const pctContactados = (n: number) =>
    contactados > 0 ? Math.round((n / contactados) * 1000) / 10 : 0;

  return {
    totales,
    porcentajes,
    evolucion: { agrupacion, puntos: evolucion },
    porSucursal: desglosar((a) => ({
      clave: claveNormalizada(a.caso.sucursal || ""),
      nombre: a.caso.sucursal || "(sin dato)",
    })),
    porAsesor: desglosar((a) => ({
      clave: claveAgrupacionAsesor(a.caso.asesor || "", a.caso.asesorCodigo),
      nombre: a.caso.asesor || "(sin dato)",
    })),
    tasaRespuesta: {
      contactados,
      respondidos: conteoEstados.RESPONDIDO ?? 0,
      noRespondieron: conteoEstados.NO_RESPONDIO ?? 0,
      enviadosSinRespuestaAun: conteoEstados.ENVIADO ?? 0,
      conErrorDeEnvio: conteoEstados.ERROR ?? 0,
      internosExcluidos: conteoEstados.INTERNO ?? 0,
      pendientesSinContactar: conteoEstados.PENDIENTE ?? 0,
      pctRespondidos: pctContactados(conteoEstados.RESPONDIDO ?? 0),
      pctNoRespondieron: pctContactados(conteoEstados.NO_RESPONDIO ?? 0),
    },
  };
}

// ---------- REPORTE 2: Causa raíz ----------

export interface FiltrosCausaRaiz extends FiltrosReporte {
  categoria?: string;
  incluirAmarilloSinRqr: boolean;
}

export async function reporteCausaRaiz(f: FiltrosCausaRaiz) {
  // Área: se filtra por el área del PROPIO RQR (los manuales sin caso también la
  // tienen), no por la del caso. Sucursal/asesor/período sí dependen del caso;
  // si hay alguno, los RQR manuales (sin caso) quedan fuera, que es lo correcto.
  const areaRqr: Prisma.RQRWhereInput = f.area ? { area: f.area } : {};
  const hayFiltroDeCaso = !!(f.sucursal || f.asesor || f.periodo);
  const filtroCaso: Prisma.CasoWhereInput = {
    eliminadoEn: null,
    ...(f.sucursal ? { sucursal: { equals: f.sucursal, mode: "insensitive" } } : {}),
    ...(f.asesor ? { asesor: { contains: f.asesor, mode: "insensitive" } } : {}),
    ...(f.periodo ? { upload: { periodo: f.periodo } } : {}),
  };

  // 1) Todos los RQR del período (abiertos y cerrados)
  const rqrs = await prisma.rQR.findMany({
    where: {
      eliminadoEn: null, // excluye RQR borrados lógicamente
      fechaApertura: rangoFechas(f),
      ...areaRqr,
      ...(f.categoria ? { causaRaiz: f.categoria } : {}),
      // Con filtro de caso (sucursal/asesor/período) se aplica filtroCaso, que
      // ya exige caso.eliminadoEn=null y de paso excluye los manuales (correcto:
      // no tienen sucursal). SIN filtro de caso NO se puede dejar el where sin
      // condición de caso: un RQR de un caso borrado lógicamente reaparecería
      // (el filtro de arriba solo mira RQR.eliminadoEn, no el del caso). Se
      // incluyen entonces los manuales (casoId null) O los de un caso vivo.
      ...(hayFiltroDeCaso
        ? { caso: filtroCaso }
        : { OR: [{ casoId: null }, { caso: { eliminadoEn: null } }] }),
    },
    include: {
      caso: {
        select: {
          id: true, numeroOrden: true, nombrePropietario: true, whatsapp: true, celular: true,
          modelo: true, sucursal: true, asesor: true, fechaSalida: true, fechaProgramacion: true,
        },
      },
      sentimentAnalysis: {
        select: { semaforo: true, severidad: true, resumenIA: true, message: { select: { content: true } } },
      },
    },
    orderBy: { fechaApertura: "desc" },
  });

  // 2) Amarillos que no generaron RQR (opcional)
  const amarillosSinRqr = f.incluirAmarilloSinRqr
    ? await prisma.sentimentAnalysis.findMany({
        where: {
          esSeguimiento: false, // ídem: un amarillo de seguimiento no se lista aparte
          semaforo: Semaforo.AMARILLO,
          rqr: null,
          analyzedAt: rangoFechas(f),
          ...(f.categoria ? { categoriaCausaRaiz: f.categoria } : {}),
          caso: { ...whereCaso(f), estadoContacto: { not: EstadoContacto.INTERNO } },
        },
        include: {
          caso: {
            select: {
              id: true, numeroOrden: true, nombrePropietario: true, whatsapp: true, celular: true,
              modelo: true, sucursal: true, asesor: true, fechaSalida: true, fechaProgramacion: true,
            },
          },
          message: { select: { content: true } },
        },
        orderBy: { analyzedAt: "desc" },
      })
    : [];

  // Listado combinado con la misma forma para el frontend (los RQR manuales
  // sin caso se presentan con sus datos manuales, misma estructura)
  const detalle = [
    ...rqrs.map((r) => ({
      origen: "RQR" as const,
      caso: r.caso ?? {
        id: null,
        numeroOrden: "—",
        nombrePropietario: r.nombreClienteManual ?? "(cliente sin caso)",
        whatsapp: r.telefonoManual ?? "",
        celular: "",
        modelo: r.modeloManual ?? "—",
        sucursal: "—",
        asesor: r.asesor,
        fechaSalida: null,
        fechaProgramacion: r.fechaApertura,
      },
      semaforo: r.sentimentAnalysis?.semaforo ?? null,
      severidad: r.sentimentAnalysis?.severidad ?? null,
      categoria: r.causaRaiz ?? "(sin categoría)",
      rqr: { id: r.id, numeroRQR: r.numeroRQR, estado: r.estado },
      resumenIA: r.sentimentAnalysis?.resumenIA ?? null,
      textoCliente: r.sentimentAnalysis?.message?.content ?? null,
      fecha: r.fechaApertura,
    })),
    ...amarillosSinRqr.map((a) => ({
      origen: "AMARILLO_SIN_RQR" as const,
      caso: a.caso,
      semaforo: a.semaforo,
      severidad: a.severidad,
      categoria: a.categoriaCausaRaiz ?? "(sin categoría)",
      rqr: null,
      resumenIA: a.resumenIA,
      textoCliente: a.message?.content ?? null,
      fecha: a.analyzedAt,
    })),
  ].sort((a, b) => b.fecha.getTime() - a.fecha.getTime());

  // Cantidad por categoría (para el gráfico de barras)
  const porCategoriaMapa = new Map<string, { total: number; conRqr: number; sinRqr: number }>();
  for (const item of detalle) {
    const fila = porCategoriaMapa.get(item.categoria) ?? { total: 0, conRqr: 0, sinRqr: 0 };
    fila.total++;
    if (item.rqr) fila.conRqr++;
    else fila.sinRqr++;
    porCategoriaMapa.set(item.categoria, fila);
  }
  const porCategoria = [...porCategoriaMapa.entries()]
    .map(([categoria, v]) => ({ categoria, ...v }))
    .sort((a, b) => b.total - a.total);

  // Tiempo promedio de cierre (solo RQR ya cerrados), general y por categoría
  const cerrados = rqrs.filter((r) => r.estado === EstadoRQR.CERRADO && r.fechaCierre);
  const diasCierre = (r: (typeof cerrados)[number]) =>
    (r.fechaCierre!.getTime() - r.fechaApertura.getTime()) / 86_400_000;
  const promedio = (valores: number[]) =>
    valores.length ? Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10 : null;

  const cierrePorCategoriaMapa = new Map<string, number[]>();
  for (const r of cerrados) {
    const k = r.causaRaiz ?? "(sin categoría)";
    cierrePorCategoriaMapa.set(k, [...(cierrePorCategoriaMapa.get(k) ?? []), diasCierre(r)]);
  }

  return {
    porCategoria,
    detalle,
    tiempoCierre: {
      promedioDias: promedio(cerrados.map(diasCierre)),
      rqrCerrados: cerrados.length,
      porCategoria: [...cierrePorCategoriaMapa.entries()].map(([categoria, valores]) => ({
        categoria,
        promedioDias: promedio(valores),
        cantidad: valores.length,
      })),
    },
  };
}
