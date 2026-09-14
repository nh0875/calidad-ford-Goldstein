import { EstadoEncuestaFabrica } from "@prisma/client";
import { prisma } from "../config/prisma";
import { claveNormalizada } from "./normalizacion.service";
import { porcentaje } from "./redondeo";

/**
 * Seguimiento MES A MES de las animaciones de encuestas de fábrica (Volkswagen).
 *
 * QUÉ ES UNA ANIMACIÓN. Fábrica le manda la encuesta al cliente por mail. Si no
 * la contesta, el sistema le avisa al VENDEDOR para que lo llame y lo anime a
 * responderla. Un cliente queda "animado" desde que salió ese aviso (avisadoEn).
 *
 * POR QUÉ avisadoEn Y NO EL ESTADO. El estado AVISADO se pisa: cuando el cliente
 * contesta pasa a RESPONDIO. Contando por estado, justo los que la animación
 * rescató desaparecerían de los animados, y la efectividad daría siempre cerca de
 * cero. La fecha, en cambio, queda. Lo único que la borra es volver el cliente a
 * Pendiente, y eso es a propósito: significa "que le vuelva a llegar al vendedor".
 *
 * DE QUÉ MES ES CADA CLIENTE: de su Fecha Dominio (ver resumirPeriodosVW). Los
 * meses son COHORTES: "agosto" son los clientes que patentaron en agosto, se los
 * haya animado cuando sea. El mes en curso todavía se está trabajando, así que sus
 * números suben solos a medida que Calidad marca respuestas.
 *
 * QUÉ SE MIDE, Y QUÉ NO. La efectividad es: de los clientes animados, cuántos
 * respondieron. Se descartó A PROPÓSITO compararla con "cuántos respondieron sin
 * que los animaran". Parece la pregunta natural —¿animar sirve?— pero con estos
 * datos da una respuesta falsa: los no animados no son un grupo de control. Con el
 * tiempo a todo pendiente se le avisa al vendedor, así que en un mes ya trabajado
 * los únicos "sin animar" que quedan son los que contestaron solos, y esa tasa
 * tiende al 100% hagan lo que hagan los vendedores. Con datos de ejemplo, un mes
 * maduro daba "sin animación 100%, con animación 81%": leído así, animar parecía
 * EMPEORAR las cosas. Lo que sí se compara bien es la efectividad de un mes contra
 * la de otro, y la de un vendedor contra la de otro. Los que contestaron por su
 * cuenta se devuelven como cantidad, de contexto, sin convertirlos en una tasa.
 *
 * UN LÍMITE que conviene tener presente: desde el 14-09-2026 la carga del Excel ya
 * no marca a nadie como respondido. "Respondió" es lo que Calidad marca a mano, y
 * estos números valen lo que valga esa carga.
 *
 * Todo el cálculo vive en calcularSeguimiento, que es una función pura: se prueba
 * sin base de datos, y la consulta queda en una sola lectura simple.
 */

/** Con menos animados que esto, un porcentaje no es representativo (1 de 1 = 100%). */
const MINIMO_ANIMADOS_RANKING = 5;

export interface ClienteSeguimiento {
  periodo: string | null;
  fechaDominio: Date | null;
  estado: EstadoEncuestaFabrica;
  avisadoEn: Date | null;
  sucursal: string;
  vendedor: { codigo: string; nombre: string | null; sucursal: string; email: string | null };
}

export interface NumerosAnimacion {
  clientes: number;
  /** PENDIENTE: todavía no se le avisó al vendedor. */
  sinAvisar: number;
  /** AVISADO: se le avisó al vendedor y el cliente todavía no contestó. */
  esperandoRespuesta: number;
  respondieron: number;
  /** Se le avisó al vendedor en algún momento, tenga el estado que tenga hoy. */
  animados: number;
  respondieronAnimados: number;
  /** Contestaron sin que se le avisara al vendedor. Cantidad de contexto, no una tasa (ver arriba). */
  respondieronSinAnimar: number;
  /** Clientes cuyo mes se estimó con la entrega porque no traían Fecha Dominio. */
  mesEstimado: number;
  /** respondieron / clientes */
  tasaRespuesta: number | null;
  /** animados / clientes: a qué parte del mes llegó la animación. */
  coberturaAnimacion: number | null;
  /** respondieron animados / animados: EL número de este seguimiento. */
  efectividadAnimacion: number | null;
}

export interface MesSeguimiento extends NumerosAnimacion {
  periodo: string;
}

export interface VendedorSeguimiento {
  codigo: string;
  nombre: string | null;
  sucursal: string;
  clientes: number;
  animados: number;
  respondieron: number;
  respondieronAnimados: number;
  efectividadAnimacion: number | null;
  tasaRespuesta: number | null;
  /** Menos animados que el mínimo: el porcentaje puede no ser representativo. */
  pocos: boolean;
}

export interface SeguimientoEncuestasVW {
  /** Un renglón por mes con clientes, del más viejo al más nuevo. */
  meses: MesSeguimiento[];
  /** Todos los meses juntos. */
  total: NumerosAnimacion;
  /** Clientes sin ningún mes: ni Fecha Dominio ni entrega. */
  sinMes: number;
  /** El mes al que se acotó el ranking de vendedores; null = todos los meses. */
  periodoVendedores: string | null;
  vendedores: VendedorSeguimiento[];
  minimoRanking: number;
}

const tasa = (parte: number, total: number): number | null => (total > 0 ? porcentaje(parte, total) : null);

function numerosDe(clientes: ReadonlyArray<ClienteSeguimiento>): NumerosAnimacion {
  let sinAvisar = 0;
  let esperandoRespuesta = 0;
  let respondieron = 0;
  let animados = 0;
  let respondieronAnimados = 0;
  let respondieronSinAnimar = 0;
  let mesEstimado = 0;

  for (const c of clientes) {
    const animado = c.avisadoEn !== null;
    if (animado) animados++;
    if (c.periodo && !c.fechaDominio) mesEstimado++;
    if (c.estado === EstadoEncuestaFabrica.PENDIENTE) sinAvisar++;
    else if (c.estado === EstadoEncuestaFabrica.AVISADO) esperandoRespuesta++;
    else if (c.estado === EstadoEncuestaFabrica.RESPONDIO) {
      respondieron++;
      if (animado) respondieronAnimados++;
      else respondieronSinAnimar++;
    }
  }

  const total = clientes.length;
  return {
    clientes: total,
    sinAvisar,
    esperandoRespuesta,
    respondieron,
    animados,
    respondieronAnimados,
    respondieronSinAnimar,
    mesEstimado,
    tasaRespuesta: tasa(respondieron, total),
    coberturaAnimacion: tasa(animados, total),
    efectividadAnimacion: tasa(respondieronAnimados, animados),
  };
}

/**
 * El seguimiento completo a partir de la lista de clientes.
 *
 * `periodo` acota SOLO el ranking de vendedores. La evolución de los meses se
 * devuelve siempre entera: para ver cómo viene un mes hay que tener los otros al
 * lado.
 */
export function calcularSeguimiento(
  clientes: ReadonlyArray<ClienteSeguimiento>,
  opciones: { periodo: string | null }
): SeguimientoEncuestasVW {
  const porMes = new Map<string, ClienteSeguimiento[]>();
  let sinMes = 0;
  for (const c of clientes) {
    if (!c.periodo) {
      sinMes++;
      continue;
    }
    const lista = porMes.get(c.periodo) ?? [];
    lista.push(c);
    porMes.set(c.periodo, lista);
  }

  const meses = [...porMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, lista]) => ({ periodo, ...numerosDe(lista) }));

  const delRanking = opciones.periodo ? (porMes.get(opciones.periodo) ?? []) : clientes;
  const porVendedor = new Map<string, { vendedor: ClienteSeguimiento["vendedor"]; lista: ClienteSeguimiento[] }>();
  for (const c of delRanking) {
    const grupo = porVendedor.get(c.vendedor.codigo) ?? { vendedor: c.vendedor, lista: [] };
    grupo.lista.push(c);
    porVendedor.set(c.vendedor.codigo, grupo);
  }

  const vendedores: VendedorSeguimiento[] = [...porVendedor.values()]
    .map(({ vendedor, lista }) => {
      const n = numerosDe(lista);
      return {
        codigo: vendedor.codigo,
        nombre: vendedor.nombre,
        sucursal: vendedor.sucursal,
        clientes: n.clientes,
        animados: n.animados,
        respondieron: n.respondieron,
        respondieronAnimados: n.respondieronAnimados,
        efectividadAnimacion: n.efectividadAnimacion,
        tasaRespuesta: n.tasaRespuesta,
        pocos: n.animados < MINIMO_ANIMADOS_RANKING,
      };
    })
    // Los que tienen muestra suficiente, arriba y por efectividad. Sin separar a
    // los de pocos animados, un vendedor con 1 de 1 encabezaría el ranking con un
    // 100% que no dice nada.
    .sort((a, b) => {
      if (a.pocos !== b.pocos) return a.pocos ? 1 : -1;
      const ea = a.efectividadAnimacion ?? -1;
      const eb = b.efectividadAnimacion ?? -1;
      if (ea !== eb) return eb - ea;
      if (a.animados !== b.animados) return b.animados - a.animados;
      return (a.nombre ?? a.codigo).localeCompare(b.nombre ?? b.codigo);
    });

  return {
    meses,
    total: numerosDe(clientes),
    sinMes,
    periodoVendedores: opciones.periodo,
    vendedores,
    minimoRanking: MINIMO_ANIMADOS_RANKING,
  };
}

/**
 * Los clientes que puede ver alguien de esa sucursal (null = todas).
 *
 * La comparación va con claveNormalizada y no con un `equals` en SQL: en la base
 * la sucursal está como vino en la hoja del Excel ("SAN JUAN") y la del usuario
 * como se cargó ("San Juan"), y Postgres no pliega acentos ni mayúsculas.
 */
export async function traerClientesSeguimiento(sucursal: string | null): Promise<ClienteSeguimiento[]> {
  const filas = await prisma.encuestaFabricaVW.findMany({
    select: {
      periodo: true,
      fechaDominio: true,
      estado: true,
      avisadoEn: true,
      sucursal: true,
      vendedor: { select: { codigo: true, nombre: true, sucursal: true, email: true } },
    },
  });
  if (!sucursal) return filas;
  const clave = claveNormalizada(sucursal);
  return filas.filter((f) => claveNormalizada(f.sucursal) === clave);
}

export async function seguimientoEncuestasVW(opciones: {
  sucursal: string | null;
  periodo: string | null;
}): Promise<SeguimientoEncuestasVW> {
  const clientes = await traerClientesSeguimiento(opciones.sucursal);
  return calcularSeguimiento(clientes, { periodo: opciones.periodo });
}
