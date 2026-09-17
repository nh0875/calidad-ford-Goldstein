import { EstadoEncuestaFabrica, TipoUpload, UploadStatus } from "@prisma/client";
import { marca } from "../config/marca";
import { prisma } from "../config/prisma";
import { abrirWorkbook } from "./excel.service";
import {
  convertirInternoAArchivo,
  esArchivoInternoVW,
  guardarMapeoVendedores,
  nombresDeVendedorDelLibro,
  resolverVendedores,
} from "./encuesta-interna-vw.service";
import { ACCIONES } from "./audit.service";
import { claveNormalizada } from "./normalizacion.service";
import {
  ArchivoEncuestaVW,
  NUMEROS_DE_MOSTRADOR,
  parsearArchivoEncuestaVW,
  periodoDeFecha,
  periodoDeFila,
  resumirPeriodosVW,
  sucursalDeCodigoVendedor,
} from "./encuesta-vw.service";

/**
 * Importa el Excel de encuestas pendientes de fábrica de Volkswagen.
 *
 * LA CARGA AGREGA CLIENTES. NO CAMBIA EL ESTADO DE NINGUNO.
 *
 * El estado de un cliente lo cambian solo dos cosas, y las dos son decisiones de
 * una persona:
 *   1. alguien lo cambia a mano desde la lista, o
 *   2. alguien aprieta "Avisar a los vendedores" (PENDIENTE → AVISADO).
 *
 * Hasta septiembre de 2026 la carga también cerraba: tomaba el archivo como una
 * foto de quién debe la encuesta HOY, y a todo cliente que ya no venía lo daba
 * por respondido. En la práctica eso le pasaba por arriba al trabajo de Calidad:
 * se subía un Excel con clientes nuevos y los pendientes que se estaban
 * gestionando aparecían como "Respondió" sin que nadie los hubiera tocado. Lo
 * pidió sacar el dueño (14-09-2026).
 *
 * LO QUE ESO IMPLICA, y conviene saberlo antes de volver a tocar esto: la tasa de
 * respuesta del tablero de Encuestas de fábrica ya no se completa sola. Cuenta
 * los clientes que alguien marcó como "Respondió" a mano, y nada más.
 */

export interface ResumenImportacionVW {
  uploadId: string;
  /** El mes con más clientes del archivo: el que se le pone a la carga. */
  periodo: string;
  /** Clientes por mes según la Fecha Dominio. Un mismo archivo trae varios. */
  meses: Array<{ periodo: string; clientes: number }>;
  /** Clientes sin Fecha Dominio: su mes se estimó con la entrega. */
  sinFechaDominio: number;
  sucursales: string[];
  vendedoresNuevos: number;
  vendedoresActualizados: number;
  vendedoresSinMail: Array<{ codigo: string; nombre: string | null; sucursal: string; pendientes: number }>;
  pendientesNuevos: number;
  /** Clientes que ya estaban en la lista: se actualizan sus datos, NO su estado. */
  pendientesQueSiguen: number;
  /** Clientes que ya estaban en un mes cerrado y siguen ahí: se corrigen sus datos, no su estado. */
  clientesDeMesesCerrados: number;
  /** Clientes cerrados que, con el mes o la provincia corregidos, caen en un mes abierto: vuelven a la lista. */
  cerradosQueVolvieron: number;
  /** Clientes NUEVOS cuyo mes ya estaba cerrado: entran a la lista, marcados. */
  nuevosEnMesesCerrados: number;
  filasRechazadas: Array<{ hoja: string; numeroFilaExcel: number; motivo: string }>;
  filasObservadasPorFabrica: number;
  /**
   * Vendedores que aparecieron con el prefijo de la OTRA sucursal y se
   * reconocieron como la misma persona (se les heredó nombre y correo).
   */
  vendedoresDeOtraSucursal: Array<{ codigo: string; nombre: string | null; vieneDe: string }>;
  avisos: string[];
}

export interface OpcionesImportacionVW {
  buffer: Buffer;
  filename: string;
  uploadedBy: string;
  /**
   * Solo para el formato INTERNO: nombre de vendedor tal como viene en el Excel
   * -> código de 7 dígitos, asignado por la persona en la vista previa. Se guarda
   * como alias para que la próxima carga lo reconozca sola.
   */
  mapeoVendedores?: Record<string, string>;
  usuarioId?: string | null;
  auditar?: (d: { accion: string; entidad: string; entidadId?: string; detalles?: unknown }) => void;
}

export async function importarEncuestaFabricaVW(
  opciones: OpcionesImportacionVW
): Promise<ResumenImportacionVW | { error: string }> {
  const workbook = abrirWorkbook(opciones.buffer);

  // Dos formatos alimentan la misma lista: el de FABRICA (una hoja por sucursal,
  // vendedor por código) y el INTERNO de la concesionaria (una sola hoja,
  // vendedor por nombre). El interno se traduce a la misma estructura y de ahí en
  // adelante el guardado es uno solo.
  if (esArchivoInternoVW(workbook)) {
    const { mapa } = await resolverVendedores(
      nombresDeVendedorDelLibro(workbook),
      opciones.mapeoVendedores ?? {}
    );
    const archivoInterno = convertirInternoAArchivo(workbook, mapa);
    if ("error" in archivoInterno) return { error: archivoInterno.error };
    if (archivoInterno.filas.length === 0) {
      const motivos = [...new Set(archivoInterno.rechazadas.map((r) => r.motivo))].slice(0, 3);
      return {
        error:
          "No se pudo importar ninguna fila. " +
          (motivos.length ? motivos.join(" ") : archivoInterno.avisos.join(" ")),
      };
    }
    if (opciones.mapeoVendedores && Object.keys(opciones.mapeoVendedores).length > 0) {
      await guardarMapeoVendedores(opciones.mapeoVendedores, opciones.usuarioId ?? null);
    }
    return guardar(archivoInterno, opciones, "INTERNO");
  }

  const archivo = parsearArchivoEncuestaVW(workbook);
  if ("error" in archivo) return { error: archivo.error };
  if (archivo.filas.length === 0) {
    return { error: "El archivo no tiene ninguna fila que se pueda importar. " + archivo.avisos.join(" ") };
  }

  return guardar(archivo, opciones, "FABRICA");
}

async function guardar(
  archivo: ArchivoEncuestaVW,
  opciones: OpcionesImportacionVW,
  origenFormato: "FABRICA" | "INTERNO"
): Promise<ResumenImportacionVW> {
  const nombresSucursal = [...new Set(archivo.hojas.map((h) => h.nombreSucursal))];

  // El período de la carga sale de la columna "Fecha Dominio": el mes con más
  // clientes. Un archivo trae VARIOS meses (ver resumirPeriodosVW), así que esto
  // solo nombra la carga: el seguimiento mes a mes se hace con el mes de CADA
  // cliente. Antes salía de la entrega más reciente, y un solo cliente de un mes
  // nuevo corría la carga entera a ese mes. Sin ninguna fecha, el mes en curso.
  const periodos = resumirPeriodosVW(archivo.filas);
  const periodo = periodos.periodo ?? periodoDeFecha(new Date())!;

  const upload = await prisma.excelUpload.create({
    data: {
      tipo: TipoUpload.ENCUESTA_FABRICA_VW,
      filename: opciones.filename,
      sucursal: nombresSucursal.join(" / ") || "—",
      periodo,
      uploadedBy: opciones.uploadedBy,
      columnMapping: {},
      totalRows: archivo.filas.length,
      status: UploadStatus.PROCESANDO,
    },
  });

  // ---- 1. Vendedores -------------------------------------------------------
  // Se crean los que falten y se completa el nombre si el archivo lo trae. NO se
  // pisa el mail ni un nombre cargado a mano: el Excel de fábrica no los tiene y
  // sobreescribirlos borraría el trabajo de Calidad en cada carga.
  // La sucursal de una fila: la del PREFIJO de su código de vendedor, que es la
  // regla estricta (1035 = Mendoza, 1036 = San Juan; ver
  // marca.refuerzo.sucursalPorCodigoVendedor). La hoja, la columna Suc. Cpa. y el
  // prefijo a secas quedan solo para un prefijo que no es de ninguna sucursal
  // conocida, que no debería pasar.
  //
  // En el formato interno esto no pierde la sucursal de la venta: el lector ya
  // armó el código con el prefijo de Suc. Cpa. (un mendocino que vendió en San
  // Juan llega acá como 1036 + su número).
  const sucursalDeFila = (f: ArchivoEncuestaVW["filas"][number]): string =>
    sucursalDeCodigoVendedor(f.codigoVendedor) ??
    archivo.hojas.find((h) => h.nombre === f.hoja)?.nombreSucursal ??
    f.sucursalVenta ??
    f.codigoSucursal;

  const porCodigo = new Map<string, { sucursal: string; nombre: string | null }>();
  for (const f of archivo.filas) {
    const previo = porCodigo.get(f.codigoVendedor);
    porCodigo.set(f.codigoVendedor, {
      sucursal: sucursalDeFila(f),
      nombre: f.nombreVendedor ?? previo?.nombre ?? null,
    });
  }

  let vendedoresNuevos = 0;
  let vendedoresActualizados = 0;
  const vendedoresDeOtraSucursal: ResumenImportacionVW["vendedoresDeOtraSucursal"] = [];
  const idPorCodigo = new Map<string, string>();

  for (const [codigo, datos] of porCodigo) {
    const existente = await prisma.vendedorVW.findUnique({ where: { codigo } });
    if (!existente) {
      // Un vendedor puede vender en la OTRA sucursal: entonces viene con el
      // prefijo de esa sucursal y el mismo número (el 078 de Mendoza vendiendo en
      // San Juan llega como 1036078). Es la misma persona.
      //
      // Sin esto el sistema daba de alta un vendedor nuevo, vacío: sin nombre y
      // SIN CORREO. Consecuencia concreta: a los clientes que esa persona vendió
      // en la otra sucursal no les avisaba nadie, porque el aviso sale por mail y
      // ese código no tenía ninguno. Ahora hereda nombre y correo del que ya está.
      const numero = Number(codigo.slice(4));
      const codigoSucursal = codigo.slice(0, 4);
      const gemelo = NUMEROS_DE_MOSTRADOR.has(numero)
        ? null
        : await prisma.vendedorVW.findFirst({
            where: { numero, codigoSucursal: { not: codigoSucursal } },
            orderBy: { creadoEn: "asc" },
          });

      const creado = await prisma.vendedorVW.create({
        data: {
          codigo,
          codigoSucursal,
          numero,
          sucursal: datos.sucursal,
          nombre: datos.nombre ?? gemelo?.nombre ?? null,
          email: gemelo?.email ?? null,
        },
      });
      if (gemelo) {
        vendedoresDeOtraSucursal.push({
          codigo,
          nombre: creado.nombre,
          vieneDe: gemelo.codigo,
        });
      }
      idPorCodigo.set(codigo, creado.id);
      vendedoresNuevos++;
      continue;
    }
    idPorCodigo.set(codigo, existente.id);
    // Solo se completa lo que falta; nunca se pisa lo que ya había. La sucursal
    // es la excepción: no la carga nadie a mano, sale del código, y si quedó mal
    // de antes (un 1036 figurando en Mendoza) se corrige acá.
    const cambios = {
      ...(!existente.nombre && datos.nombre ? { nombre: datos.nombre } : {}),
      ...(sucursalDeCodigoVendedor(codigo) && existente.sucursal !== datos.sucursal ? { sucursal: datos.sucursal } : {}),
    };
    if (Object.keys(cambios).length > 0) {
      await prisma.vendedorVW.update({ where: { id: existente.id }, data: cambios });
      vendedoresActualizados++;
    }
  }

  // ---- 2. Pendientes -------------------------------------------------------
  let pendientesNuevos = 0;
  let pendientesQueSiguen = 0;
  let clientesDeMesesCerrados = 0;
  let cerradosQueVolvieron = 0;
  let nuevosEnMesesCerrados = 0;
  // Los meses ya cerrados: para contar a los nuevos que llegan tarde a uno, y para
  // saber si un cliente cerrado sigue en un mes cerrado después de corregirle el mes
  // o la provincia.
  const cerrados = new Set(
    (
      await prisma.cierrePeriodo.findMany({
        where: { lista: "ENCUESTA_VENTAS", reabiertoEn: null },
        select: { periodo: true, sucursal: true },
      })
    ).map((c) => `${c.periodo}|${claveNormalizada(c.sucursal)}`)
  );

  for (const f of archivo.filas) {
    const vendedorId = idPorCodigo.get(f.codigoVendedor)!;
    const datos = {
      dominio: f.dominio,
      nombreCliente: f.nombreCliente,
      email: f.email,
      fechaEntrega: f.fechaEntrega,
      canalVentas: f.canalVentas,
      area: f.area,
      vendedorId,
      sucursal: sucursalDeFila(f),
      observacionesFabrica: f.observacionesFabrica,
      vistaEnUploadId: upload.id,
    };
    // El mes del cliente: el de su Fecha Dominio, o estimado con la entrega.
    const mes = periodoDeFila(f);
    const existente = await prisma.encuestaFabricaVW.findUnique({ where: { chasis: f.chasis } });
    if (existente) {
      // Se refrescan los DATOS (el correo corregido, el vendedor reasignado, lo
      // que observó fábrica) pero NO el estado ni sus fechas.
      //
      // Antes esta línea también lo volvía a PENDIENTE, y eso hacía dos daños: un
      // cliente ya avisado que seguía en el archivo volvía a Pendiente —y al
      // vendedor le llegaba otra vez en el próximo aviso—, y lo que Calidad había
      // cambiado a mano se perdía con la carga siguiente.
      //
      // El MES se trata aparte. Si esta fila trae Fecha Dominio, manda: es el dato
      // real y además corrige una estimación vieja. Si NO la trae (formato
      // interno), no se pisa un mes que ya se había leído bien de un Excel de
      // fábrica anterior; solo se completa con la entrega si no había ninguno.
      const mesActualizado = f.fechaDominio
        ? { fechaDominio: f.fechaDominio, periodo: mes.periodo }
        : !existente.periodo && mes.periodo
          ? { periodo: mes.periodo }
          : {};

      // Un cliente de un MES CERRADO también recibe los datos corregidos (el estado
      // no se toca: eso solo lo hace una persona reabriendo el mes). Importa porque
      // lo que se cerró al instalar el cierre puede traer la provincia o el mes mal
      // cargados, y el Excel es lo que los corrige. Queda cerrado mientras su mes y
      // su provincia (ya corregidos) estén cerrados; si caen en un mes abierto,
      // vuelve a la lista, porque ese mes todavía se trabaja.
      let cierre: { cerradoEn?: null } = {};
      if (existente.cerradoEn) {
        const periodoFinal = "periodo" in mesActualizado ? mesActualizado.periodo : existente.periodo;
        if (periodoFinal && cerrados.has(`${periodoFinal}|${claveNormalizada(datos.sucursal)}`)) {
          clientesDeMesesCerrados++;
        } else {
          cierre = { cerradoEn: null };
          cerradosQueVolvieron++;
        }
      }
      await prisma.encuestaFabricaVW.update({
        where: { chasis: f.chasis },
        data: { ...datos, ...mesActualizado, ...cierre },
      });
      if (!existente.cerradoEn) pendientesQueSiguen++;
    } else {
      // Un cliente NUEVO entra siempre como Pendiente. Esto no es "cambiar un
      // estado": es el que tiene al nacer.
      await prisma.encuestaFabricaVW.create({
        data: {
          ...datos,
          estado: EstadoEncuestaFabrica.PENDIENTE,
          chasis: f.chasis,
          origenUploadId: upload.id,
          origenFormato,
          fechaDominio: f.fechaDominio ?? null,
          periodo: mes.periodo,
        },
      });
      pendientesNuevos++;
      if (mes.periodo && cerrados.has(`${mes.periodo}|${claveNormalizada(datos.sucursal)}`)) nuevosEnMesesCerrados++;
    }
  }

  // Acá había un tercer paso que daba por respondidos a los que ya no venían en
  // el archivo. Se sacó a propósito: ver el comentario del principio.

  await prisma.excelUpload.update({ where: { id: upload.id }, data: { status: UploadStatus.COMPLETADO } });

  // ---- 3. Qué falta para poder avisar --------------------------------------
  const sinMail = await prisma.vendedorVW.findMany({
    where: { codigo: { in: [...porCodigo.keys()] }, OR: [{ email: null }, { email: "" }] },
    select: { codigo: true, nombre: true, sucursal: true, _count: { select: { pendientes: true } } },
  });

  opciones.auditar?.({
    accion: ACCIONES.EXCEL_ENCUESTA_VW_IMPORTADO,
    entidad: "ExcelUpload",
    entidadId: upload.id,
    detalles: {
      tipo: "ENCUESTA_FABRICA_VW",
      sucursales: nombresSucursal,
      filas: archivo.filas.length,
      pendientesNuevos,
      pendientesQueSiguen,
      periodo,
      meses: periodos.meses,
      sinFechaDominio: periodos.sinFechaDominio,
    },
  });

  return {
    uploadId: upload.id,
    periodo,
    meses: periodos.meses,
    sinFechaDominio: periodos.sinFechaDominio,
    sucursales: nombresSucursal,
    vendedoresNuevos,
    vendedoresActualizados,
    vendedoresSinMail: sinMail.map((v) => ({
      codigo: v.codigo,
      nombre: v.nombre,
      sucursal: v.sucursal,
      pendientes: v._count.pendientes,
    })),
    pendientesNuevos,
    pendientesQueSiguen,
    clientesDeMesesCerrados,
    cerradosQueVolvieron,
    nuevosEnMesesCerrados,
    vendedoresDeOtraSucursal,
    filasRechazadas: archivo.rechazadas,
    filasObservadasPorFabrica: archivo.filas.filter((f) => f.observacionesFabrica.length > 0).length,
    avisos: archivo.avisos,
  };
}

/**
 * Deja la sucursal de vendedores y clientes como dice su código (regla estricta:
 * 1035 = Mendoza, 1036 = San Juan; ver marca.refuerzo.sucursalPorCodigoVendedor).
 *
 * POR QUÉ CORRE AL ARRANCAR. Hasta el 16-09-2026 la sucursal salía del nombre de
 * la hoja del Excel: quedaron vendedores 1036 figurando en Mendoza, y los clientes
 * del formato interno quedaron con "1035" o "1036" a secas, que ningún filtro por
 * provincia reconocía. Corre siempre y, una vez corregido, no toca nada. En las
 * marcas sin este Excel el mapa está vacío y no hace nada.
 *
 * UN LÍMITE que no se puede salvar desde acá: de esos clientes del formato interno
 * nunca se guardó la columna Suc. Cpa. Un mendocino que vendió en San Juan quedó
 * colgado de su 1035 y pasa a Mendoza. Lo que los ubica bien es volver a subir el
 * último Excel interno (la carga reasigna vendedor y sucursal por chasis, sin tocar
 * el estado). `internosSinSucursalDeVenta` cuenta cuántos había, para el log.
 *
 * Un código con un prefijo que no es de ninguna sucursal conocida no se toca.
 */
export async function corregirSucursalesPorCodigo(): Promise<{
  vendedores: number;
  clientes: number;
  internosSinSucursalDeVenta: number;
}> {
  const prefijos = Object.keys(marca.refuerzo.sucursalPorCodigoVendedor);
  // Se cuentan ANTES de corregir: después ya no se distinguen de los demás.
  const internosSinSucursalDeVenta =
    prefijos.length === 0
      ? 0
      : await prisma.encuestaFabricaVW.count({ where: { origenFormato: "INTERNO", sucursal: { in: prefijos } } });
  let vendedores = 0;
  let clientes = 0;
  for (const [prefijo, nombre] of Object.entries(marca.refuerzo.sucursalPorCodigoVendedor)) {
    const sucursal = nombre.toUpperCase();
    vendedores += (
      await prisma.vendedorVW.updateMany({
        where: { codigoSucursal: prefijo, NOT: { sucursal } },
        data: { sucursal },
      })
    ).count;
    clientes += (
      await prisma.encuestaFabricaVW.updateMany({
        where: { vendedor: { codigoSucursal: prefijo }, NOT: { sucursal } },
        data: { sucursal },
      })
    ).count;
  }
  return { vendedores, clientes, internosSinSucursalDeVenta };
}

/**
 * Completa el nombre y el correo que le faltan a un código con los de su otro
 * código de la MISMA persona (el 1036078 con los del 1035078).
 *
 * POR QUÉ. Desde el 16-09-2026 el nombre y el correo son de la persona y se guardan
 * en todos sus códigos, pero hasta ese día se cargaban de a uno: quedaron códigos
 * con correo y su gemelo sin. Sin esto, el aviso o el tablero podían tratar a esa
 * persona como "sin correo" según qué código mirasen.
 *
 * Solo COMPLETA lo vacío: nunca pisa un valor cargado. Si los dos códigos tienen
 * valores distintos no se toca nada y se devuelve para el log. El mostrador (002) es
 * uno por sucursal y no se empareja. Idempotente; en Ford no hay vendedores VW.
 */
export async function completarDatosDePersonas(): Promise<{ completados: number; distintos: string[] }> {
  const todos = await prisma.vendedorVW.findMany({
    select: { id: true, codigo: true, numero: true, nombre: true, email: true },
    orderBy: { codigo: "asc" },
  });
  const porNumero = new Map<number, typeof todos>();
  for (const v of todos) {
    if (NUMEROS_DE_MOSTRADOR.has(v.numero)) continue;
    porNumero.set(v.numero, [...(porNumero.get(v.numero) ?? []), v]);
  }

  let completados = 0;
  const distintos: string[] = [];
  for (const grupo of porNumero.values()) {
    if (grupo.length < 2) continue;
    for (const campo of ["email", "nombre"] as const) {
      const valores = [...new Set(grupo.map((v) => (v[campo] ?? "").trim()).filter(Boolean))];
      if (valores.length > 1) {
        distintos.push(`${grupo.map((v) => v.codigo).join("/")} ${campo}: ${valores.join(" | ")}`);
        continue;
      }
      if (valores.length === 0) continue;
      const vacios = grupo.filter((v) => !(v[campo] ?? "").trim()).map((v) => v.id);
      if (vacios.length === 0) continue;
      completados += (
        await prisma.vendedorVW.updateMany({ where: { id: { in: vacios } }, data: { [campo]: valores[0] } })
      ).count;
    }
  }
  return { completados, distintos };
}
