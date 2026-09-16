// Seguimiento MES A MES de las animaciones de encuestas de fábrica (Volkswagen).
//
// Una "animación" es el aviso al vendedor para que llame al cliente y lo anime a
// contestar la encuesta de fábrica. El mes de cada cliente sale de la columna
// Fecha Dominio del Excel: cada mes es el grupo de clientes que patentó ese mes.
//
// Lo usan dos pantallas: Encuestas de fábrica (completo, con el mes elegible) y
// el tablero principal (los últimos meses). Por eso vive acá y no adentro de una.
import { useState } from "react";
import { numero, porcentaje } from "../lib/numeros";

export interface NumerosAnimacion {
  clientes: number;
  sinAvisar: number;
  esperandoRespuesta: number;
  respondieron: number;
  animados: number;
  respondieronAnimados: number;
  /** Contestaron sin que se le avisara al vendedor: cantidad de contexto, no una tasa. */
  respondieronSinAnimar: number;
  mesEstimado: number;
  tasaRespuesta: number | null;
  coberturaAnimacion: number | null;
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
  pocos: boolean;
}

export interface SeguimientoEncuestas {
  meses: MesSeguimiento[];
  total: NumerosAnimacion;
  sinMes: number;
  periodoVendedores?: string | null;
  vendedores: VendedorSeguimiento[];
  minimoRanking: number;
}

/**
 * Los textos que cambian según quién anima. En Ventas se le AVISA al vendedor para
 * que llame al cliente; en Posventa lo anima Calidad directamente y la persona del
 * ranking es el asesor de servicio. El cálculo es el mismo en las dos.
 */
export interface TextosAnimacion {
  /** Cómo se llama el estado del que todavía no se animó. */
  sinAnimar: string;
  /** Qué significa "animado" (para el título de la columna). */
  animadoAyuda: string;
  /** "Por su cuenta": respondieron sin que se los animara. */
  porSuCuentaAyuda: string;
  /** La persona del ranking. */
  persona: string;
  /** Qué ayuda da la columna de animados del ranking. */
  personaAnimadosAyuda: string;
  /** Cuando el ranking está vacío. */
  personaVacio: string;
}

export const TEXTOS_VENTAS: TextosAnimacion = {
  sinAnimar: "Sin avisar",
  animadoAyuda: "Clientes a los que se les avisó al vendedor, y qué parte del mes son",
  porSuCuentaAyuda: "Respondieron sin que se le avisara al vendedor",
  persona: "Vendedor",
  personaAnimadosAyuda: "Clientes a los que se le avisó a este vendedor",
  personaVacio: "Todavía no hay vendedores con clientes en este mes.",
};

export const TEXTOS_POSVENTA: TextosAnimacion = {
  sinAnimar: "Sin animar",
  animadoAyuda: "Clientes que Calidad ya animó a responder, y qué parte del mes son",
  porSuCuentaAyuda: "Respondieron sin que Calidad los animara",
  persona: "Asesor",
  personaAnimadosAyuda: "Clientes de este asesor que Calidad ya animó",
  personaVacio: "Todavía no hay asesores con clientes en este mes.",
};

const NOMBRES_MES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** "2026-08" -> "Agosto 2026". */
export function etiquetaMes(periodo: string | null | undefined): string {
  if (!periodo) return "Sin mes";
  const m = periodo.match(/^(\d{4})-(\d{2})$/);
  const nombre = m ? NOMBRES_MES[Number(m[2]) - 1] : undefined;
  return m && nombre ? `${nombre} ${m[1]}` : periodo;
}

/** "2026-08" -> "Ago 2026", para el eje donde el nombre completo no entra. */
function etiquetaMesCorta(periodo: string): string {
  const m = periodo.match(/^(\d{4})-(\d{2})$/);
  const nombre = m ? NOMBRES_MES[Number(m[2]) - 1] : undefined;
  return m && nombre ? `${nombre.slice(0, 3)} ${m[1]}` : periodo;
}

/** El mes en curso: sus números todavía se están moviendo. */
function mesEnCurso(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Colores de la barra
// ---------------------------------------------------------------------------
//
// Son los MISMOS tres estados que la lista de clientes (Respondió / Avisado /
// Pendiente), con el mismo tono de cada uno, para que la barra se lea con la
// referencia de color que ya se trae de la lista.
//
// Validados con validate_palette.js (modo claro, sobre blanco, en el orden de la
// barra): pasan la banda de luminosidad, el croma y la separación para
// daltonismo, con el par más cercano en ΔE 25,5.
//
// EL AMARILLO NO ES EL DEL SEMÁFORO. #fab219 es demasiado claro para una barra
// (L 0,81, fuera de la banda 0,43-0,77) y el validador lo rechazó. #ca8a04 es el
// paso más cercano del mismo tono que pasa.
//
// El celeste y el amarillo quedan por debajo de 3:1 de contraste contra el blanco.
// Por eso el color nunca va solo: leyenda siempre, el total escrito en la punta
// de cada barra, y la tabla con todos los números al lado.
const SERIES = [
  { clave: "respondieron", etiqueta: "Respondieron", color: "#0ca30c" },
  { clave: "esperandoRespuesta", etiqueta: "Esperando respuesta", color: "#00B0F0" },
  { clave: "sinAvisar", etiqueta: "Sin avisar", color: "#ca8a04" },
] as const;

type ClaveSerie = (typeof SERIES)[number]["clave"];

/** La etiqueta de una serie con el texto de la pantalla (el amarillo cambia de nombre). */
function etiquetaSerie(clave: ClaveSerie, etiqueta: string, textos: TextosAnimacion): string {
  return clave === "sinAvisar" ? textos.sinAnimar : etiqueta;
}

function Leyenda({ textos }: { textos: TextosAnimacion }) {
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-ink-muted">
      {SERIES.map((s) => (
        <span key={s.clave} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden="true" />
          {etiquetaSerie(s.clave, s.etiqueta, textos)}
        </span>
      ))}
    </div>
  );
}

/**
 * Un renglón por mes: cuántos clientes tiene y en qué estado están.
 *
 * Barra apilada horizontal: es una parte-del-todo por mes, y en horizontal los
 * nombres de los meses entran sin girarlos. El largo es la cantidad de clientes
 * (todos los meses contra el mismo máximo), así se compara el volumen de un vistazo.
 *
 * Con `onSeleccionar`, el nombre del mes es un botón que lo elige (y lo suelta si
 * ya estaba elegido).
 */
export function BarrasAnimacionPorMes({
  meses,
  seleccionado,
  onSeleccionar,
  textos = TEXTOS_VENTAS,
}: {
  meses: MesSeguimiento[];
  seleccionado?: string;
  onSeleccionar?: (periodo: string) => void;
  textos?: TextosAnimacion;
}) {
  const [foco, setFoco] = useState<{ periodo: string; clave: ClaveSerie } | null>(null);

  if (meses.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-muted">Todavía no hay clientes con mes.</p>;
  }

  const maximo = Math.max(1, ...meses.map((m) => m.clientes));
  const enCurso = mesEnCurso();

  return (
    <div>
      <div className="space-y-1" role="group" aria-label="Clientes por mes y estado de la encuesta">
        {meses.map((m) => {
          const partes = SERIES.map((s) => ({ ...s, valor: m[s.clave] })).filter((p) => p.valor > 0);
          const activo = seleccionado === m.periodo;
          const enFoco = foco?.periodo === m.periodo ? SERIES.find((s) => s.clave === foco.clave) : undefined;
          return (
            <div
              key={m.periodo}
              className={`relative flex items-center gap-2 rounded-md px-1 transition-colors ${activo ? "bg-accent-light/60" : ""}`}
            >
              <button
                type="button"
                onClick={() => onSeleccionar?.(activo ? "" : m.periodo)}
                disabled={!onSeleccionar}
                className="w-20 shrink-0 text-right text-xs text-ink-muted enabled:hover:text-ink disabled:cursor-default"
                title={onSeleccionar ? (activo ? "Ver todos los meses" : `Ver solo ${etiquetaMes(m.periodo)}`) : undefined}
              >
                <span className={activo ? "font-semibold text-ink" : ""}>{etiquetaMesCorta(m.periodo)}</span>
                {m.periodo === enCurso && <span className="block text-[10px] leading-tight">en curso</span>}
              </button>

              {/* La pista ocupa todo el ancho libre y la barra es un porcentaje de
                  ella: el total escrito queda afuera, en su propia columna, y nunca
                  lo empuja ni lo tapa una barra larga. */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="h-7 min-w-0 flex-1">
                  <div
                    className="flex h-7 items-center gap-[2px]"
                    style={{ width: `${(m.clientes / maximo) * 100}%`, minWidth: partes.length * 8 }}
                  >
                    {partes.map((p, i) => (
                      // Todo el alto del renglón es zona de hover, no solo los 20px
                      // pintados: apuntarle a una barra fina no tiene que ser puntería.
                      <div
                        key={p.clave}
                        tabIndex={0}
                        role="img"
                        aria-label={`${etiquetaMes(m.periodo)}: ${p.valor} de ${m.clientes}, ${etiquetaSerie(p.clave, p.etiqueta, textos).toLowerCase()}`}
                        onMouseEnter={() => setFoco({ periodo: m.periodo, clave: p.clave })}
                        onMouseLeave={() => setFoco(null)}
                        onFocus={() => setFoco({ periodo: m.periodo, clave: p.clave })}
                        onBlur={() => setFoco(null)}
                        className="flex h-7 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-navy"
                        style={{ flexGrow: p.valor, flexBasis: 0, minWidth: 6 }}
                      >
                        <div
                          className={`h-5 w-full transition-opacity ${i === partes.length - 1 ? "rounded-r" : ""} ${
                            enFoco && enFoco.clave !== p.clave ? "opacity-50" : ""
                          }`}
                          style={{ backgroundColor: p.color }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-ink">{numero(m.clientes)}</span>
              </div>

              {enFoco && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-24 z-10 mb-1 whitespace-nowrap rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
                >
                  <div className="font-semibold tabular-nums text-ink">
                    {numero(m[enFoco.clave])} de {numero(m.clientes)}
                  </div>
                  <div className="flex items-center gap-1.5 text-ink-muted">
                    <span className="inline-block h-0.5 w-3" style={{ backgroundColor: enFoco.color }} aria-hidden="true" />
                    {etiquetaSerie(enFoco.clave, enFoco.etiqueta, textos)} · {etiquetaMes(m.periodo)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Leyenda textos={textos} />
    </div>
  );
}

/**
 * La tabla de los meses. Es la vista que tiene TODOS los números: la barra se ve,
 * la tabla se lee.
 *
 * La columna que manda es "Efectividad": de los animados, cuántos respondieron, y
 * se lee comparando un mes contra otro. NO hay una columna "sin animación" para
 * compararla, y no es un olvido: ese grupo tiende al 100% en todo mes ya trabajado
 * (ver seguimiento-encuesta-vw.service.ts) y hacía parecer que animar empeoraba.
 * "Por su cuenta" queda como cantidad, de contexto.
 */
export function TablaAnimacionPorMes({
  meses,
  total,
  seleccionado,
  textos = TEXTOS_VENTAS,
}: {
  meses: MesSeguimiento[];
  total?: NumerosAnimacion;
  seleccionado?: string;
  textos?: TextosAnimacion;
}) {
  const enCurso = mesEnCurso();

  const Celdas = ({ n }: { n: NumerosAnimacion }) => (
    <>
      <td className="px-3 py-2 text-right tabular-nums text-ink">{numero(n.clientes)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
        {numero(n.animados)}
        <span className="ml-1 text-xs text-ink-muted">({porcentaje(n.coberturaAnimacion)})</span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-ink">{numero(n.respondieron)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-ink">{porcentaje(n.tasaRespuesta)}</td>
      <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{porcentaje(n.efectividadAnimacion)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{numero(n.respondieronSinAnimar)}</td>
    </>
  );

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            <th className="px-3 py-2">Mes</th>
            <th className="px-3 py-2 text-right">Clientes</th>
            <th className="px-3 py-2 text-right" title={textos.animadoAyuda}>
              Animados
            </th>
            <th className="px-3 py-2 text-right">Respondieron</th>
            <th className="px-3 py-2 text-right" title="Respondieron sobre el total de clientes del mes">
              Tasa de respuesta
            </th>
            <th className="px-3 py-2 text-right" title="De los clientes animados, qué parte respondió">
              Efectividad
            </th>
            <th className="px-3 py-2 text-right" title={textos.porSuCuentaAyuda}>
              Por su cuenta
            </th>
          </tr>
        </thead>
        <tbody>
          {/* El mes más nuevo arriba: es el que se está trabajando. */}
          {[...meses].reverse().map((m) => (
            <tr
              key={m.periodo}
              className={`border-b border-gray-100 ${seleccionado === m.periodo ? "bg-accent-light/40" : ""}`}
            >
              <td className="whitespace-nowrap px-3 py-2 text-ink">
                {etiquetaMes(m.periodo)}
                {m.periodo === enCurso && (
                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">EN CURSO</span>
                )}
                {m.mesEstimado > 0 && (
                  <span
                    className="ml-2 text-[11px] text-ink-muted"
                    title="No traían Fecha Dominio: su mes se estimó con la fecha de entrega."
                  >
                    · {m.mesEstimado} estimado{m.mesEstimado === 1 ? "" : "s"}
                  </span>
                )}
              </td>
              <Celdas n={m} />
            </tr>
          ))}
        </tbody>
        {total && meses.length > 1 && (
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-medium">
              <td className="px-3 py-2 text-ink">Todos los meses</td>
              <Celdas n={total} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * Qué vendedores animan mejor: de sus clientes animados, cuántos respondieron.
 *
 * Los de pocos animados van al final y marcados. Sin eso, un vendedor con 1 de 1
 * encabezaría el ranking con un 100% que no dice nada (el orden lo trae el backend).
 */
export function RankingVendedoresAnimacion({
  vendedores,
  minimo,
  compacto = false,
  textos = TEXTOS_VENTAS,
}: {
  vendedores: VendedorSeguimiento[];
  minimo: number;
  compacto?: boolean;
  textos?: TextosAnimacion;
}) {
  if (vendedores.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-muted">{textos.personaVacio}</p>;
  }
  const hayPocos = vendedores.some((v) => v.pocos);
  return (
    <div>
      <div className={compacto ? "overflow-x-auto" : "max-h-96 overflow-auto"}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b text-[11px] uppercase tracking-wider text-ink-muted">
              <th className="px-2 py-1.5 text-left">{textos.persona}</th>
              <th className="px-2 py-1.5 text-right" title={textos.personaAnimadosAyuda}>
                Animados
              </th>
              <th className="px-2 py-1.5 text-right" title="De esos clientes animados, cuántos respondieron">
                Respondieron
              </th>
              <th className="px-2 py-1.5 text-right" title="Respondieron sobre animados">
                Efectividad
              </th>
            </tr>
          </thead>
          <tbody>
            {vendedores.map((v) => (
              <tr key={v.codigo} className="border-b border-gray-100">
                <td className="px-2 py-1.5">
                  <div className="text-ink">
                    {v.nombre || `${textos.persona} ${v.codigo}`}
                    {v.pocos && (
                      <span
                        className="ml-1 text-[10px] text-ink-muted"
                        title={`Menos de ${minimo} clientes animados: la efectividad puede no ser representativa.`}
                      >
                        ·pocos
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-ink-muted">{v.sucursal}</div>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{numero(v.animados)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{numero(v.respondieronAnimados)}</td>
                <td className="px-2 py-1.5 text-right font-medium tabular-nums text-ink">{porcentaje(v.efectividadAnimacion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hayPocos && (
        <p className="mt-1.5 text-[11px] text-ink-muted">
          "·pocos" = menos de {minimo} clientes animados; la efectividad puede no ser representativa.
        </p>
      )}
    </div>
  );
}
