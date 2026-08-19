import {
  AreaTrabajo,
  EncuestaFordEstado,
  EstadoEncuestaFabrica,
  EstadoContacto,
  EstadoRQR,
  EstadoTareaRefuerzo,
  MessageDirection,
  Prisma,
} from "@prisma/client";
import { marca } from "../config/marca";
import { prisma } from "../config/prisma";
import { FiltrosReporte, reporteCausaRaiz, reporteSentimiento } from "./reporte.service";
import { nombreClienteRqr } from "./rqr.service";

// Un ranking con menos casos que esto distorsiona (una sola respuesta mala = 100% rojo)
const MINIMO_CASOS_RANKING = 5;
const RQR_ABIERTOS_EN_LISTA = 10;
const VENDEDORES_EN_TABLERO = 5;

/**
 * Encuestas de fábrica de Volkswagen para el tablero.
 *
 * Devuelve null en las marcas que no usan este circuito, así el tablero no
 * muestra un panel vacío.
 *
 * "Respondieron" son los que dejaron de venir en el Excel de pendientes: fábrica
 * no nos dice quién contestó, se deduce de su ausencia (ver la importación).
 */
async function resumenEncuestaFabrica() {
  if (marca.refuerzo.formatoExcel !== "VW") return null;

  const [porEstado, porSucursal, vendedores] = await Promise.all([
    prisma.encuestaFabricaVW.groupBy({ by: ["estado"], _count: { _all: true } }),
    prisma.encuestaFabricaVW.groupBy({
      by: ["sucursal"],
      where: { estado: EstadoEncuestaFabrica.PENDIENTE },
      _count: { _all: true },
    }),
    prisma.vendedorVW.findMany({
      where: { pendientes: { some: { estado: EstadoEncuestaFabrica.PENDIENTE } } },
      select: {
        codigo: true,
        nombre: true,
        email: true,
        sucursal: true,
        _count: { select: { pendientes: { where: { estado: EstadoEncuestaFabrica.PENDIENTE } } } },
      },
    }),
  ]);

  const cuenta = (e: EstadoEncuestaFabrica) =>
    porEstado.find((g) => g.estado === e)?._count._all ?? 0;
  const pendientes = cuenta(EstadoEncuestaFabrica.PENDIENTE);
  const respondieron = cuenta(EstadoEncuestaFabrica.RESPONDIO);
  const total = pendientes + respondieron;

  // Los que más deben, arriba: es la lista con la que se decide a quién apurar.
  const ranking = vendedores
    .map((v) => ({
      codigo: v.codigo,
      nombre: v.nombre,
      sucursal: v.sucursal,
      sinCorreo: !v.email,
      pendientes: v._count.pendientes,
    }))
    .sort((a, b) => b.pendientes - a.pendientes);

  return {
    pendientes,
    respondieron,
    tasaRespuesta: total > 0 ? Math.round((respondieron / total) * 1000) / 10 : null,
    vendedoresConPendientes: ranking.length,
    // Sin correo cargado no se les puede avisar: es lo que traba el circuito.
    vendedoresSinCorreo: ranking.filter((v) => v.sinCorreo).length,
    porSucursal: porSucursal
      .map((g) => ({ sucursal: g.sucursal, pendientes: g._count._all }))
      .sort((a, b) => b.pendientes - a.pendientes),
    topVendedores: ranking.slice(0, VENDEDORES_EN_TABLERO),
  };
}

export async function dashboardResumen(f: FiltrosReporte) {
  const rangoFechas = {
    ...(f.fechaDesde ? { gte: new Date(`${f.fechaDesde}T00:00:00`) } : {}),
    ...(f.fechaHasta ? { lte: new Date(`${f.fechaHasta}T23:59:59.999`) } : {}),
  };
  const filtroSucursal = f.sucursal
    ? { sucursal: { equals: f.sucursal, mode: "insensitive" as const } }
    : {};
  // Restricción por área (la fija el controller); vacío = todas.
  const filtroArea: Prisma.CasoWhereInput = f.area ? { area: f.area } : {};

  // Reusa las agregaciones de los reportes para no duplicar lógica
  const [sentimiento, causaRaiz] = await Promise.all([
    reporteSentimiento(f),
    reporteCausaRaiz({ ...f, incluirAmarilloSinRqr: true }),
  ]);

  // Desglose por área: solo cuando el usuario ve más de un área (admin/AMBAS sin
  // filtrar). Semáforo y tasa de respuesta separados porque VENTAS y POSVENTA no
  // son comparables entre sí.
  let desgloseArea: null | Record<string, { totales: typeof sentimiento.totales; porcentajes: typeof sentimiento.porcentajes; tasaRespuesta: typeof sentimiento.tasaRespuesta }> = null;
  if (!f.area) {
    const [ventas, posventa] = await Promise.all([
      reporteSentimiento({ ...f, area: AreaTrabajo.VENTAS }),
      reporteSentimiento({ ...f, area: AreaTrabajo.POSVENTA }),
    ]);
    desgloseArea = {
      VENTAS: { totales: ventas.totales, porcentajes: ventas.porcentajes, tasaRespuesta: ventas.tasaRespuesta },
      POSVENTA: { totales: posventa.totales, porcentajes: posventa.porcentajes, tasaRespuesta: posventa.tasaRespuesta },
    };
  }

  // Casos CARGADOS en el período (createdAt = fecha de importación del Excel,
  // no la fecha del turno: así el dashboard habla del trabajo del período)
  const whereCasosPeriodo: Prisma.CasoWhereInput = {
    createdAt: rangoFechas,
    estadoContacto: { not: EstadoContacto.INTERNO },
    eliminadoEn: null,
    ...filtroArea,
    ...filtroSucursal,
  };
  const totalCasos = await prisma.caso.count({ where: whereCasosPeriodo });

  // Mensajes salientes enviados en el período
  const mensajesSalientes = await prisma.whatsappMessage.count({
    where: {
      direction: MessageDirection.SALIENTE,
      createdAt: rangoFechas,
      caso: { eliminadoEn: null, ...filtroArea, ...(f.sucursal ? filtroSucursal : {}) },
    },
  });

  // Top 3 categorías de causa raíz del período
  const topCategorias = causaRaiz.porCategoria
    .filter((c) => c.categoria !== "(sin categoría)")
    .slice(0, 3);

  // RQR abiertos AHORA (estado, no período) — los manuales sin caso solo
  // entran cuando no se filtra por sucursal (no tienen sucursal propia)
  const whereAbiertos: Prisma.RQRWhereInput = {
    estado: { in: [EstadoRQR.ABIERTO, EstadoRQR.EN_TRATAMIENTO] },
    eliminadoEn: null,
    ...(f.area ? { area: f.area } : {}), // área del RQR
    ...(f.sucursal ? { caso: filtroSucursal } : {}),
  };
  const abiertos = await prisma.rQR.findMany({
    where: whereAbiertos,
    orderBy: { fechaApertura: "asc" }, // los más viejos primero, para priorizar cierre
    include: {
      caso: { select: { nombrePropietario: true, sucursal: true, modelo: true } },
    },
  });
  const ahora = Date.now();
  const diasAbierto = (fecha: Date) => Math.floor((ahora - fecha.getTime()) / 86_400_000);
  const rqrAbiertos = {
    total: abiertos.length,
    antiguedadPromedioDias:
      abiertos.length > 0
        ? Math.round(
            (abiertos.reduce((acc, r) => acc + diasAbierto(r.fechaApertura), 0) / abiertos.length) * 10
          ) / 10
        : null,
    lista: abiertos.slice(0, RQR_ABIERTOS_EN_LISTA).map((r) => ({
      id: r.id,
      numeroRQR: r.numeroRQR,
      cliente: nombreClienteRqr(r),
      sucursal: r.caso?.sucursal ?? "—",
      modelo: r.caso?.modelo ?? r.modeloManual ?? "—",
      causaRaiz: r.causaRaiz,
      estado: r.estado,
      diasAbierto: diasAbierto(r.fechaApertura),
    })),
  };

  // Distribución de origen del agendamiento + tasa de respuesta por origen,
  // sobre el mismo universo de casos del período que totalCasos
  const porOrigenEstado = await prisma.caso.groupBy({
    by: ["origenAgendamiento", "estadoContacto"],
    where: whereCasosPeriodo,
    _count: { _all: true },
  });
  const origenes = new Map<string, { total: number; respondidos: number; contactados: number }>();
  for (const g of porOrigenEstado) {
    const fila = origenes.get(g.origenAgendamiento) ?? { total: 0, respondidos: 0, contactados: 0 };
    fila.total += g._count._all;
    if (g.estadoContacto !== EstadoContacto.PENDIENTE) {
      fila.contactados += g._count._all;
      if (g.estadoContacto === EstadoContacto.RESPONDIDO) fila.respondidos += g._count._all;
    }
    origenes.set(g.origenAgendamiento, fila);
  }
  const porOrigen = [...origenes.entries()]
    .map(([origen, v]) => ({
      origen,
      total: v.total,
      tasaRespuesta: v.contactados > 0 ? Math.round((v.respondidos / v.contactados) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.total - a.total);

  // Tasa de respuesta global sobre esos mismos casos del período
  const sumaEstado = (estado: EstadoContacto) =>
    porOrigenEstado
      .filter((g) => g.estadoContacto === estado)
      .reduce((acc, g) => acc + g._count._all, 0);
  const respondidos = sumaEstado(EstadoContacto.RESPONDIDO);
  const noRespondieron = sumaEstado(EstadoContacto.NO_RESPONDIO);
  const enviados = sumaEstado(EstadoContacto.ENVIADO);
  const conError = sumaEstado(EstadoContacto.ERROR);
  const contactados = respondidos + noRespondieron + enviados + conError;
  const pctContactados = (n: number) =>
    contactados > 0 ? Math.round((n / contactados) * 1000) / 10 : 0;

  // Parte B: encuesta oficial de Ford (estado actual, no atado al período).
  // Tasa = RESPONDIDA / (RESPONDIDA + PENDIENTE_RESPUESTA + EMAIL_INVALIDO);
  // NO_ELEGIBLE y SIN_DATO quedan fuera (nunca tuvieron chance real de responder).
  const fordPorEstado = await prisma.caso.groupBy({
    by: ["encuestaFordEstado"],
    where: { eliminadoEn: null, ...filtroArea, ...filtroSucursal },
    _count: { _all: true },
  });
  const ford: Record<string, number> = {};
  for (const g of fordPorEstado) ford[g.encuestaFordEstado] = g._count._all;
  const fordRespondidas = ford[EncuestaFordEstado.RESPONDIDA] ?? 0;
  const fordPendientes = ford[EncuestaFordEstado.PENDIENTE_RESPUESTA] ?? 0;
  const fordEmailInvalido = ford[EncuestaFordEstado.EMAIL_INVALIDO] ?? 0;
  const fordDenom = fordRespondidas + fordPendientes + fordEmailInvalido;
  const tareasRefuerzoAbiertas = await prisma.tareaRefuerzo.count({
    where: {
      estado: { in: [EstadoTareaRefuerzo.PENDIENTE, EstadoTareaRefuerzo.EN_GESTION] },
      ...(f.area ? { caso: { area: f.area } } : {}),
    },
  });
  const encuestaFord = {
    respondidas: fordRespondidas,
    pendientes: fordPendientes,
    emailInvalido: fordEmailInvalido,
    noElegible: ford[EncuestaFordEstado.NO_ELEGIBLE] ?? 0,
    sinDato: ford[EncuestaFordEstado.SIN_DATO] ?? 0,
    tasaRespuesta: fordDenom > 0 ? Math.round((fordRespondidas / fordDenom) * 1000) / 10 : null,
    tareasAbiertas: tareasRefuerzoAbiertas,
  };

  // El MISMO indicador para las marcas cuya encuesta de fábrica vive en su
  // propia lista (Volkswagen). El bloque de arriba se calcula sobre los Casos, y
  // los clientes de la encuesta de VW no son Casos —no traen teléfono, no se los
  // puede contactar por WhatsApp—, así que ahí daba SIEMPRE cero.
  const encuestaFabrica = await resumenEncuestaFabrica();

  return {
    periodo: { fechaDesde: f.fechaDesde ?? null, fechaHasta: f.fechaHasta ?? null },
    totalCasos,
    mensajesSalientes,
    encuestaFord,
    // null en las marcas que no usan este circuito (el tablero no lo muestra).
    encuestaFabrica,
    tasaRespuesta: {
      contactados,
      respondidos,
      noRespondieron,
      enviadosSinRespuestaAun: enviados,
      conErrorDeEnvio: conError,
      pendientesSinContactar: sumaEstado(EstadoContacto.PENDIENTE),
      pctRespondidos: pctContactados(respondidos),
      pctNoRespondieron: pctContactados(noRespondieron),
    },
    // Con qué escala mide esta marca (SEMAFORO en Ford, ESTRELLAS en VW).
    escala: sentimiento.escala,
    semaforo: {
      totales: sentimiento.totales,
      porcentajes: sentimiento.porcentajes,
    },
    // Desempeño en estrellas: promedio, distribución de los 5 puntajes y el
    // % de 5 (el único puntaje que no abre RQR en Volkswagen). En las marcas
    // que miden por semáforo viene en cero y el tablero no lo muestra.
    estrellas: sentimiento.estrellas,
    evolucion: sentimiento.evolucion,
    topCategorias,
    rqrAbiertos,
    // TODOS los asesores y sucursales con su semáforo (sin ocultar los de pocos
    // casos). El frontend marca los que tienen menos de MINIMO_CASOS_RANKING,
    // donde el % de rojos puede no ser representativo.
    rankingSucursales: sentimiento.porSucursal,
    rankingAsesores: sentimiento.porAsesor,
    minimoCasosRanking: MINIMO_CASOS_RANKING,
    porOrigen,
    desgloseArea,
  };
}
