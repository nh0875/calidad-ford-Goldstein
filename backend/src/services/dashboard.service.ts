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
import { porcentaje, promedio } from "./redondeo";
import { prisma } from "../config/prisma";
import { FALTA_CLASIFICAR } from "./causa-raiz.service";
import { FiltrosReporte, reporteCausaRaiz, reporteSentimiento } from "./reporte.service";
import { nombreClienteRqr } from "./rqr.service";
import { calcularSeguimiento, traerClientesSeguimiento } from "./seguimiento-encuesta-vw.service";

// Un ranking con menos casos que esto distorsiona (una sola respuesta mala = 100% rojo)
const MINIMO_CASOS_RANKING = 5;
const RQR_ABIERTOS_EN_LISTA = 10;
const VENDEDORES_EN_TABLERO = 5;
// Cuántos meses de animaciones muestra el tablero (la pantalla de encuestas, todos).
const MESES_EN_TABLERO = 6;

/**
 * Encuestas de fábrica de Volkswagen para el tablero.
 *
 * Devuelve null en las marcas que no usan este circuito, así el tablero no
 * muestra un panel vacío.
 *
 * "Respondieron" son los que Calidad marcó como respondidos a mano: desde el
 * 14-09-2026 la carga del Excel ya no cierra a nadie (ver la importación).
 *
 * DOS COSAS QUE SE CORRIGIERON ACÁ, y conviene no volver a romper:
 *  - La tasa se calculaba sobre PENDIENTE + RESPONDIO y dejaba afuera a los
 *    AVISADO, el estado del medio que se agregó después. Justo los clientes que
 *    el vendedor ya había animado desaparecían del numerador y del denominador:
 *    con 10 sin avisar, 50 avisados y 10 respondidos daba 50% cuando es 14%.
 *    Ahora el total son TODOS los clientes.
 *  - No miraba la provincia. En Volkswagen se aplica en todo el sistema, y el
 *    tablero ya la recibe resuelta en `sucursal` (la del usuario le gana al filtro).
 */
async function resumenEncuestaFabrica(sucursal: string | null, sucursalGraficos: string | null) {
  if (marca.refuerzo.formatoExcel !== "VW") return null;

  const clientes = await traerClientesSeguimiento(sucursal);
  const conEstado = (e: EstadoEncuestaFabrica) => clientes.filter((c) => c.estado === e);
  const sinAvisar = conEstado(EstadoEncuestaFabrica.PENDIENTE);
  const esperandoRespuesta = conEstado(EstadoEncuestaFabrica.AVISADO).length;
  const respondieron = conEstado(EstadoEncuestaFabrica.RESPONDIO).length;
  // "Sin responder" son los pendientes Y los avisados: al avisado ya se le mandó
  // el correo al vendedor, pero el cliente todavía no contestó.
  const sinResponder = clientes.filter((c) => c.estado !== EstadoEncuestaFabrica.RESPONDIO);

  // Un renglón por PERSONA: el 1035078 y el 1036078 son el mismo vendedor en dos
  // sucursales y se suman, igual que en la pantalla de Encuestas de fábrica.
  const juntar = (lista: string, valor: string) =>
    lista.split(" · ").includes(valor) ? lista : [...lista.split(" · "), valor].sort().join(" · ");
  const personaDe = (c: (typeof clientes)[number]) => c.vendedor.persona ?? c.vendedor.codigo;
  const porVendedor = new Map<string, { codigo: string; nombre: string | null; sucursal: string; pendientes: number }>();
  const porSucursal = new Map<string, number>();
  for (const c of sinResponder) {
    const v = porVendedor.get(personaDe(c)) ?? {
      codigo: c.vendedor.codigo,
      nombre: c.vendedor.nombre,
      sucursal: c.vendedor.sucursal,
      pendientes: 0,
    };
    v.codigo = juntar(v.codigo, c.vendedor.codigo);
    v.sucursal = juntar(v.sucursal, c.vendedor.sucursal);
    v.nombre = v.nombre ?? c.vendedor.nombre;
    v.pendientes++;
    porVendedor.set(personaDe(c), v);
    porSucursal.set(c.sucursal, (porSucursal.get(c.sucursal) ?? 0) + 1);
  }

  // Sin correo cargado no se le puede avisar, y eso solo traba a los que todavía
  // tienen clientes SIN AVISAR: a los avisados el correo ya les salió.
  // El correo es de la persona: si alguno de sus códigos lo tiene, el aviso sale.
  const personasConCorreo = new Set(clientes.filter((c) => c.vendedor.email).map(personaDe));
  const personasSinCorreo = new Set(sinAvisar.map(personaDe).filter((p) => !personasConCorreo.has(p)));

  // Los que más deben, arriba: es la lista con la que se decide a quién apurar.
  const ranking = [...porVendedor.entries()]
    .map(([persona, v]) => ({ ...v, sinCorreo: personasSinCorreo.has(persona) }))
    .sort((x, y) => y.pendientes - x.pendientes);

  // Los gráficos mes a mes son de todos (16-09-2026): con la sucursal elegida, o las
  // dos, igual que en la pantalla de Encuestas de fábrica. Los números de arriba
  // (pendientes, vendedores) siguen siendo de la provincia del usuario.
  const clientesGraficos =
    sucursalGraficos === sucursal ? clientes : await traerClientesSeguimiento(sucursalGraficos);
  const seguimiento = calcularSeguimiento(clientesGraficos, { periodo: null });

  return {
    total: clientes.length,
    sinAvisar: sinAvisar.length,
    esperandoRespuesta,
    // Los que todavía deben la encuesta: pendientes y avisados.
    pendientes: sinResponder.length,
    respondieron,
    tasaRespuesta: clientes.length > 0 ? porcentaje(respondieron, clientes.length) : null,
    vendedoresConPendientes: ranking.length,
    vendedoresSinCorreo: personasSinCorreo.size,
    porSucursal: [...porSucursal.entries()]
      .map(([suc, pendientes]) => ({ sucursal: suc, pendientes }))
      .sort((x, y) => y.pendientes - x.pendientes),
    topVendedores: ranking.slice(0, VENDEDORES_EN_TABLERO),
    // Cómo van las animaciones mes a mes, y qué vendedores rinden más. El tablero
    // muestra los últimos meses; la pantalla de encuestas, todos.
    seguimiento: {
      meses: seguimiento.meses.slice(-MESES_EN_TABLERO),
      total: seguimiento.total,
      sinMes: seguimiento.sinMes,
      vendedores: seguimiento.vendedores.slice(0, VENDEDORES_EN_TABLERO),
      minimoRanking: seguimiento.minimoRanking,
    },
  };
}

export async function dashboardResumen(f: FiltrosReporte, sucursalGraficos: string | null = f.sucursal ?? null) {
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
    // Los que están sin clasificar no son una causa: no pueden entrar al top 3.
    .filter((c) => c.categoria !== FALTA_CLASIFICAR)
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
      // El asesor que quedó en el RQR al abrirlo (pedido de Calidad, 16-09-2026).
      asesor: r.asesor,
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
      tasaRespuesta: v.contactados > 0 ? porcentaje(v.respondidos, v.contactados) : null,
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

  // Los tres estados del circuito de insistencia (Volkswagen). En las marcas sin
  // circuito dan cero y nada de esto cambia.
  const enTercerContacto = sumaEstado(EstadoContacto.LLAMADA_PENDIENTE);
  const respondioLlamada = sumaEstado(EstadoContacto.RESPONDIO_LLAMADA);
  const noRespondeContactos = sumaEstado(EstadoContacto.NO_RESPONDE_CONTACTOS);

  // Los tres van adentro de "contactados", y no es un detalle: son clientes a los
  // que SÍ se les escribió. Sin ellos, cada caso que entra al circuito se caía
  // del denominador y la tasa de respuesta subía sola a medida que la gente NO
  // contestaba, que es exactamente al revés de lo que tiene que pasar.
  const contactados =
    respondidos + noRespondieron + enviados + conError + enTercerContacto + respondioLlamada + noRespondeContactos;

  // Quien contestó por teléfono contestó igual: cuenta como respuesta. Se guarda
  // aparte para poder responder "¿cuánto nos rinde insistir?", que es la pregunta
  // por la que existe todo este circuito.
  const respondieronEnTotal = respondidos + respondioLlamada;
  const pctContactados = (n: number) =>
    porcentaje(n, contactados);

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
    tasaRespuesta: fordDenom > 0 ? porcentaje(fordRespondidas, fordDenom) : null,
    tareasAbiertas: tareasRefuerzoAbiertas,
  };

  // El MISMO indicador para las marcas cuya encuesta de fábrica vive en su
  // propia lista (Volkswagen). El bloque de arriba se calcula sobre los Casos, y
  // los clientes de la encuesta de VW no son Casos —no traen teléfono, no se los
  // puede contactar por WhatsApp—, así que ahí daba SIEMPRE cero.
  const encuestaFabrica = await resumenEncuestaFabrica(f.sucursal ?? null, sucursalGraficos);

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
      // Sumando los que se rescataron por teléfono. La diferencia entre este
      // número y pctRespondidos ES el rendimiento del circuito de insistencia.
      respondieronEnTotal,
      pctRespondieronEnTotal: pctContactados(respondieronEnTotal),
    },
    // El embudo de contactos, para seguir dónde se traba la gente. null en las
    // marcas sin circuito, así el tablero no muestra una sección vacía.
    circuitoContacto: marca.segundoContacto
      ? {
          // Se le escribió y todavía no se le insistió: son los que esperan el 2°.
          esperandoInsistencia: enviados,
          // Ya se les insistió (tengan el estado que tengan hoy). Se cuenta por la
          // FECHA y no por el estado: el estado sigue moviéndose después, la fecha
          // queda para siempre.
          insistidos: await prisma.caso.count({
            // El MISMO universo que el resto del bloque: los casos del período
            // con los filtros de área y provincia ya aplicados. Contar sobre otro
            // conjunto haría que los números del embudo no cierren con los de
            // arriba, que es peor que no tener el embudo.
            where: { ...whereCasosPeriodo, segundoContactoEn: { not: null } },
          }),
          // No contestaron ninguno de los dos WhatsApp: hay que llamarlos.
          tercerContactoPendiente: enTercerContacto,
          // Se rescataron por teléfono.
          respondioLlamada,
          // Se agotaron los tres contactos.
          noRespondeContactos,
        }
      : null,
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
