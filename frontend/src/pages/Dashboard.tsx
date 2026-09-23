import { useCallback, useEffect, useState } from "react";
import { getMarca } from "../lib/marca";
import { DECIMALES, numero, porcentaje, promedio } from "../lib/numeros";
import { Link } from "react-router-dom";
import { DatabaseBackup, PartyPopper } from "lucide-react";
import { apiGet } from "../lib/api";
import { getUsuario, veTodasLasAreas } from "../lib/auth";
import { etiquetaCategoria, etiquetasCategorias } from "../lib/categorias";
import { AREAS, etiquetaArea } from "../lib/area";
import { FiltroFecha, FiltroSelect, FiltroTexto } from "../components/filtros";
import { DistribucionEstrellas, DistribucionSemaforo, EvolucionSemaforo } from "../components/graficos";
import {
  BarrasAnimacionPorMes,
  RankingVendedoresAnimacion,
  SeguimientoEncuestas,
  TablaAnimacionPorMes,
} from "../components/SeguimientoAnimaciones";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { SkeletonKpiCard } from "../components/ui/Skeleton";
import AnimatedNumber from "../components/ui/AnimatedNumber";

interface Resumen {
  periodo: { fechaDesde: string | null; fechaHasta: string | null };
  totalCasos: number;
  mensajesSalientes: number;
  tasaRespuesta: {
    contactados: number;
    respondidos: number;
    pctRespondidos: number;
    // Sumando los que se rescataron por telefono.
    respondieronEnTotal: number;
    pctRespondieronEnTotal: number;
  };
  // El embudo de contactos. null en las marcas sin circuito de insistencia.
  circuitoContacto: {
    esperandoInsistencia: number;
    insistidos: number;
    tercerContactoPendiente: number;
    respondioLlamada: number;
    noRespondeContactos: number;
  } | null;
  escala: "SEMAFORO" | "ESTRELLAS";
  semaforo: {
    totales: { VERDE: number; AMARILLO: number; ROJO: number; sinClasificar: number; revisionManual: number };
    porcentajes: { VERDE: number; AMARILLO: number; ROJO: number };
  };
  // Desempeño en estrellas (Volkswagen). En las marcas de semáforo viene en cero.
  estrellas: {
    conPuntaje: number;
    distribucion: Record<"1" | "2" | "3" | "4" | "5", number>;
    promedio: number | null;
    pctCinco: number;
  };
  evolucion: {
    agrupacion: "dia" | "semana";
    puntos: Array<{
      fecha: string;
      VERDE: number;
      AMARILLO: number;
      ROJO: number;
      promedioEstrellas: number | null;
    }>;
  };
  topCategorias: Array<{ categoria: string; total: number; conRqr: number; sinRqr: number }>;
  rqrAbiertos: {
    total: number;
    antiguedadPromedioDias: number | null;
    lista: Array<{
      id: string;
      numeroRQR: string;
      cliente: string;
      sucursal: string;
      modelo: string;
      asesor: string;
      causasRaiz: string[];
      estado: string;
      diasAbierto: number;
    }>;
  };
  rankingSucursales: Ranking[];
  rankingAsesores: Ranking[];
  minimoCasosRanking: number;
  porOrigen: Array<{ origen: string; total: number; tasaRespuesta: number | null }>;
  encuestaFord: {
    respondidas: number;
    pendientes: number;
    emailInvalido: number;
    noElegible: number;
    sinDato: number;
    tasaRespuesta: number | null;
    tareasAbiertas: number;
  };
  // Solo en las marcas cuya encuesta de fábrica vive en su propia lista (VW).
  encuestaFabrica: null | {
    total: number;
    sinAvisar: number;
    esperandoRespuesta: number;
    /** Los que todavía deben la encuesta: sin avisar + esperando respuesta. */
    pendientes: number;
    respondieron: number;
    tasaRespuesta: number | null;
    vendedoresConPendientes: number;
    vendedoresSinCorreo: number;
    porSucursal: Array<{ sucursal: string; pendientes: number }>;
    topVendedores: Array<{ codigo: string; nombre: string | null; sucursal: string; sinCorreo: boolean; pendientes: number }>;
    /** Las animaciones mes a mes (los últimos meses) y los vendedores que mejor animan. */
    seguimiento: SeguimientoEncuestas;
  };
  desgloseArea: null | Record<
    string,
    {
      totales: { VERDE: number; AMARILLO: number; ROJO: number; sinClasificar: number; revisionManual: number };
      porcentajes: { VERDE: number; AMARILLO: number; ROJO: number };
      tasaRespuesta: { contactados: number; respondidos: number; pctRespondidos: number };
    }
  >;
}

interface Ranking {
  nombre: string;
  VERDE: number;
  AMARILLO: number;
  ROJO: number;
  total: number;
  pctRojos: number;
  // Desempeño en estrellas de ese asesor/sucursal (null en las marcas de semáforo).
  promedioEstrellas: number | null;
  pctCinco: number;
}

function hace30Dias(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
}
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

const ETIQUETA_ORIGEN: Record<string, string> = {
  DEALER: "Dealer",
  FORDPASS: "FordPass",
  ONLINEBOOKING: "Onlinebooking",
  OTRO: "Otro",
};

export default function Dashboard() {
  const [fechaDesde, setFechaDesde] = useState(hace30Dias());
  const [fechaHasta, setFechaHasta] = useState(hoy());
  const [sucursal, setSucursal] = useState("");
  const [area, setArea] = useState("");
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esAdmin = getUsuario()?.rol === "ADMIN";
  const puedeFiltrarArea = veTodasLasAreas(getUsuario());

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (fechaDesde) params.set("fechaDesde", fechaDesde);
      if (fechaHasta) params.set("fechaHasta", fechaHasta);
      if (sucursal.trim()) params.set("sucursal", sucursal.trim());
      if (area) params.set("area", area);
      setResumen(await apiGet<Resumen>(`/api/dashboard/resumen?${params}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar el dashboard. Probá recargar la página.");
    }
  }, [fechaDesde, fechaHasta, sucursal, area]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const maxOrigen = Math.max(1, ...(resumen?.porOrigen.map((o) => o.total) ?? [1]));
  // Esta marca mide en estrellas Y hay casos puntuados. Si todavia no hay
  // ninguno se muestra el semaforo derivado, que al menos no deja el tablero
  // en blanco el primer dia.
  const porEstrellas = resumen?.escala === "ESTRELLAS" && resumen.estrellas.conPuntaje > 0;

  return (
    <div className="space-y-4">
      {/* Selector de rango global */}
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FiltroFecha etiqueta="Desde" valor={fechaDesde} onChange={setFechaDesde} />
        <FiltroFecha etiqueta="Hasta" valor={fechaHasta} onChange={setFechaHasta} />
        <FiltroTexto etiqueta="Sucursal" valor={sucursal} placeholder="Todas" onChange={setSucursal} />
        {puedeFiltrarArea ? (
          <FiltroSelect
            etiqueta="Área"
            valor={area}
            opciones={AREAS.map((a) => ({ value: a, label: etiquetaArea(a) }))}
            onChange={setArea}
          />
        ) : (
          <div className="flex items-end text-xs text-ink-muted">Todos los indicadores excluyen casos internos.</div>
        )}
      </Card>

      {error && <Alert tono="error">{error}</Alert>}

      {esAdmin && <EstadoBackupCard />}

      {!resumen && !error && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonKpiCard key={i} />
          ))}
        </div>
      )}

      {resumen && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi
              titulo="Casos del período"
              valor={resumen.totalCasos}
              detalle={`${resumen.mensajesSalientes} WhatsApp enviados`}
              color="text-ink"
            />
            {/* Con circuito de insistencia, la tasa que importa incluye a los que
                contestaron por telefono: son respuestas igual, y dejarlos afuera
                haria parecer que insistir no sirve. Sin circuito, se muestra la
                de siempre. */}
            {resumen.circuitoContacto ? (
              <Kpi
                titulo="Tasa de respuesta"
                valor={resumen.tasaRespuesta.pctRespondieronEnTotal}
                decimales={DECIMALES}
                sufijo="%"
                detalle={`${resumen.tasaRespuesta.respondieronEnTotal} de ${resumen.tasaRespuesta.contactados} · ${resumen.circuitoContacto.respondioLlamada} por llamada`}
                color="text-accent-dark"
              />
            ) : (
              <Kpi
                titulo="Tasa de respuesta"
                valor={resumen.tasaRespuesta.pctRespondidos}
                decimales={DECIMALES}
                sufijo="%"
                detalle={`${resumen.tasaRespuesta.respondidos} de ${resumen.tasaRespuesta.contactados}`}
                color="text-accent-dark"
              />
            )}
            {porEstrellas ? (
              <>
                {/* El promedio es el numero que se puede seguir mes a mes: con
                    tres colores no habia forma de decir "mejoramos un poco". */}
                <Kpi
                  titulo="Promedio"
                  valor={resumen.estrellas.promedio ?? 0}
                decimales={DECIMALES}
                  sufijo=" ★"
                  detalle={`sobre ${resumen.estrellas.conPuntaje} caso(s) puntuados`}
                  color="text-accent-dark"
                />
                {/* En Volkswagen el 5 es el UNICO puntaje que no abre RQR:
                    este porcentaje es la meta real del area. */}
                <Kpi
                  titulo="5 estrellas"
                  valor={resumen.estrellas.pctCinco}
                decimales={DECIMALES}
                  sufijo="%"
                  detalle={`${resumen.estrellas.distribucion["5"]} caso(s) perfectos`}
                  color="text-green-700"
                />
                <Kpi
                  titulo="1 y 2 estrellas"
                  valor={resumen.estrellas.distribucion["1"] + resumen.estrellas.distribucion["2"]}
                  detalle="clientes disconformes"
                  color="text-red-700"
                />
              </>
            ) : (
              <>
                <Kpi
                  titulo="Verdes"
                  punto="VERDE"
                  valor={resumen.semaforo.porcentajes.VERDE}
                decimales={DECIMALES}
                  sufijo="%"
                  detalle={`${resumen.semaforo.totales.VERDE} casos`}
                  color="text-green-700"
                />
                <Kpi
                  titulo="Amarillos"
                  punto="AMARILLO"
                  valor={resumen.semaforo.porcentajes.AMARILLO}
                decimales={DECIMALES}
                  sufijo="%"
                  detalle={`${resumen.semaforo.totales.AMARILLO} casos`}
                  color="text-yellow-700"
                />
                <Kpi
                  titulo="Rojos"
                  punto="ROJO"
                  valor={resumen.semaforo.porcentajes.ROJO}
                decimales={DECIMALES}
                  sufijo="%"
                  detalle={`${resumen.semaforo.totales.ROJO} casos`}
                  color="text-red-700"
                />
              </>
            )}
            <Kpi
              titulo="RQR abiertos"
              valor={resumen.rqrAbiertos.total}
              detalle={
                resumen.rqrAbiertos.antiguedadPromedioDias !== null
                  ? `${resumen.rqrAbiertos.antiguedadPromedioDias} días promedio`
                  : "sin abiertos"
              }
              color="text-red-700"
            />
          </div>

          {/* El embudo de contactos (solo donde existe el circuito de insistencia).
              Responde de un vistazo la pregunta por la que se armó todo esto:
              ¿dónde se traba la gente, y cuántos rescatamos insistiendo? */}
          {resumen.circuitoContacto && (
            <Card>
              <h3 className="mb-1 text-sm font-semibold text-ink">Circuito de contacto</h3>
              <p className="mb-3 text-xs text-ink-muted">
                Qué pasó con cada cliente al que se le escribió: primero el WhatsApp inicial, después la
                insistencia, y por último la llamada.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <PasoCircuito
                  titulo="Esperando insistencia"
                  valor={resumen.circuitoContacto.esperandoInsistencia}
                  detalle="Recibieron el 1° y todavía no se les insistió"
                  clase="bg-yellow-50 text-yellow-900"
                />
                <PasoCircuito
                  titulo="Ya se les insistió"
                  valor={resumen.circuitoContacto.insistidos}
                  detalle="Recibieron el 2° contacto"
                  clase="bg-accent-light text-accent-dark"
                />
                <PasoCircuito
                  titulo="3° contacto pendiente"
                  valor={resumen.circuitoContacto.tercerContactoPendiente}
                  detalle="Hay que llamarlos"
                  clase="bg-red-50 text-red-900"
                />
                <PasoCircuito
                  titulo="Respondió por llamada"
                  valor={resumen.circuitoContacto.respondioLlamada}
                  detalle="Se rescataron por teléfono"
                  clase="bg-green-50 text-green-900"
                />
                <PasoCircuito
                  titulo="No responde contactos"
                  valor={resumen.circuitoContacto.noRespondeContactos}
                  detalle="Se agotaron los tres intentos"
                  clase="bg-gray-100 text-ink-muted"
                />
              </div>
            </Card>
          )}

          {/* Comparativa por área (solo cuando el admin ve las dos) */}
          {resumen.desgloseArea && (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-ink">Comparativa por área</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {(["VENTAS", "POSVENTA"] as const).map((a) => {
                  const d = resumen.desgloseArea![a];
                  const clasif = d.totales.VERDE + d.totales.AMARILLO + d.totales.ROJO;
                  return (
                    <div key={a} className="rounded-lg border border-gray-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-medium text-ink">{etiquetaArea(a)}</span>
                        <span className="text-xs text-ink-muted">{clasif} clasificados</span>
                      </div>
                      <div className="flex gap-4 text-sm">
                        <span className="text-green-700">● {porcentaje(d.porcentajes.VERDE)}</span>
                        <span className="text-yellow-700">● {porcentaje(d.porcentajes.AMARILLO)}</span>
                        <span className="text-red-700">● {porcentaje(d.porcentajes.ROJO)}</span>
                      </div>
                      <div className="mt-2 text-xs text-ink-muted">
                        Tasa de respuesta:{" "}
                        <span className="font-medium text-ink">{porcentaje(d.tasaRespuesta.pctRespondidos)}</span> (
                        {d.tasaRespuesta.respondidos}/{d.tasaRespuesta.contactados})
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                Ventas y Posventa se muestran por separado porque no son comparables entre sí.
              </p>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Distribución + top causas */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-ink">
                {porEstrellas ? "Distribución de puntajes" : "Distribución del semáforo"}
              </h3>
              {porEstrellas ? (
                <DistribucionEstrellas
                  distribucion={resumen.estrellas.distribucion}
                  conPuntaje={resumen.estrellas.conPuntaje}
                />
              ) : (
                <DistribucionSemaforo totales={resumen.semaforo.totales} porcentajes={resumen.semaforo.porcentajes} />
              )}
              {resumen.semaforo.totales.revisionManual > 0 && (
                <Link
                  to="/seguimiento"
                  className="mt-2 inline-block text-xs font-medium text-purple-700 hover:underline"
                >
                  ⚠ {resumen.semaforo.totales.revisionManual} respuesta(s) pendientes de revisión manual — clasificar →
                </Link>
              )}
              <h4 className="mb-1 mt-5 text-xs font-semibold uppercase text-ink-muted">Top causas raíz del período</h4>
              {resumen.topCategorias.length > 0 ? (
                <>
                <ol className="space-y-1 text-sm">
                  {resumen.topCategorias.map((c, i) => (
                    <li key={c.categoria} className="flex justify-between border-t border-gray-100 py-1">
                      <span className="text-ink">
                        {i + 1}. {etiquetaCategoria(c.categoria)}
                      </span>
                      <span className="font-medium text-ink">{c.total}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-1 text-[11px] text-ink-muted">Un RQR con varias causas suma en cada una.</p>
                </>
              ) : (
                <p className="text-sm text-ink-muted">Todavía no hay causas registradas en este período.</p>
              )}
            </Card>

            {/* Evolución */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-ink">
                Evolución {resumen.evolucion.agrupacion === "semana" ? "semanal" : "diaria"}
              </h3>
              <EvolucionSemaforo puntos={resumen.evolucion.puntos} agrupacion={resumen.evolucion.agrupacion} />
            </Card>
          </div>

          {/* Encuesta de fábrica. Son dos paneles distintos porque son dos
              circuitos distintos, y cada marca ve SOLO el suyo: el de Ford se
              calcula sobre los Casos, y en VW esos números daban siempre cero
              porque sus clientes de encuesta no son Casos. */}
          {getMarca().modulos.refuerzo && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">Encuesta oficial de {getMarca().nombre}</h3>
                <Link to="/refuerzos" className="text-xs font-medium text-accent-dark hover:underline">
                  Ir a los refuerzos →
                </Link>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                <MiniKpi titulo="Tasa de respuesta" valor={porcentaje(resumen.encuestaFord.tasaRespuesta)} color="text-accent-dark" />
                <MiniKpi titulo="Respondidas" valor={resumen.encuestaFord.respondidas} color="text-green-700" />
                <MiniKpi titulo="Pendientes" valor={resumen.encuestaFord.pendientes} color="text-yellow-700" />
                <MiniKpi titulo="Email inválido" valor={resumen.encuestaFord.emailInvalido} color="text-amber-700" />
                <MiniKpi titulo="No elegibles" valor={resumen.encuestaFord.noElegible} color="text-ink-muted" />
                <MiniKpi titulo="Tareas abiertas" valor={resumen.encuestaFord.tareasAbiertas} color="text-red-700" />
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                La tasa excluye los no elegibles (opt-out / cuarentena) y los que nunca tuvieron una invitación de {getMarca().nombre}.
              </p>
            </Card>
          )}

          {resumen.encuestaFabrica && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">Encuestas de fábrica</h3>
                <Link to="/encuestas-fabrica" className="text-xs font-medium text-accent-dark hover:underline">
                  Ver por vendedor →
                </Link>
              </div>
              {/* La tasa va sobre TODOS los clientes. Antes se calculaba sin los
                  avisados y salía inflada justo cuando más se animaba. */}
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <MiniKpi titulo="Tasa de respuesta" valor={porcentaje(resumen.encuestaFabrica.tasaRespuesta)} color="text-accent-dark" />
                <MiniKpi titulo="Respondieron" valor={resumen.encuestaFabrica.respondieron} color="text-green-700" />
                <MiniKpi titulo="Esperando respuesta" valor={resumen.encuestaFabrica.esperandoRespuesta} color="text-accent-dark" />
                <MiniKpi titulo="Sin avisar" valor={resumen.encuestaFabrica.sinAvisar} color="text-yellow-700" />
                <MiniKpi titulo="Vendedores con pendientes" valor={resumen.encuestaFabrica.vendedoresConPendientes} color="text-ink" />
                <MiniKpi
                  titulo="Sin correo cargado"
                  valor={resumen.encuestaFabrica.vendedoresSinCorreo}
                  color={resumen.encuestaFabrica.vendedoresSinCorreo > 0 ? "text-red-700" : "text-ink-muted"}
                />
              </div>

              {resumen.encuestaFabrica.porSucursal.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {resumen.encuestaFabrica.porSucursal.map((s) => (
                    <span key={s.sucursal} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-ink">
                      {s.sucursal}: <strong>{s.pendientes}</strong>
                    </span>
                  ))}
                </div>
              )}

              {resumen.encuestaFabrica.topVendedores.length > 0 && (
                <div className="mt-4">
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Los que más deben
                  </div>
                  <div className="space-y-1">
                    {resumen.encuestaFabrica.topVendedores.map((v) => (
                      <div key={v.codigo} className="flex items-center gap-2 text-sm">
                        <span className="w-8 text-right font-semibold text-ink">{v.pendientes}</span>
                        <span className="text-ink">{v.nombre || `Vendedor ${v.codigo}`}</span>
                        <span className="text-xs text-ink-muted">{v.sucursal}</span>
                        {v.sinCorreo && <span className="text-xs text-red-700">— falta el correo</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Este texto decía que "respondieron" se deduce de que el cliente deje
                  de venir en el Excel. Desde el 14-09-2026 eso ya no pasa. */}
              <p className="mt-3 text-xs text-ink-muted">
                «Respondieron» son los clientes que Calidad marcó a mano: la carga del Excel ya no le cambia el estado a nadie.
                {resumen.encuestaFabrica.vendedoresSinCorreo > 0 &&
                  " A los vendedores sin correo no se les puede avisar hasta que se les cargue."}
              </p>
            </Card>
          )}

          {resumen.encuestaFabrica && <AnimacionesMesAMes seguimiento={resumen.encuestaFabrica.seguimiento} />}

          <div className="grid gap-4 lg:grid-cols-2">
            <TablaRanking
              titulo="Todas las sucursales"
              filas={resumen.rankingSucursales}
              minimo={resumen.minimoCasosRanking}
              porEstrellas={porEstrellas}
            />
            <TablaRanking
              titulo="Todos los asesores"
              filas={resumen.rankingAsesores}
              minimo={resumen.minimoCasosRanking}
              porEstrellas={porEstrellas}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* RQR abiertos priorizados */}
            <Card>
              <h3 className="mb-2 text-sm font-semibold text-ink">RQR abiertos (los más viejos primero)</h3>
              {resumen.rqrAbiertos.lista.length === 0 ? (
                <EmptyState icono={PartyPopper} titulo="No hay RQR abiertos" descripcion="Todos los reclamos están resueltos por ahora." />
              ) : (
                <ul className="divide-y divide-gray-100">
                  {resumen.rqrAbiertos.lista.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <Link to={`/rqr/${r.id}`} className="font-medium text-accent-dark hover:underline">
                          {r.numeroRQR}
                        </Link>
                        <span className="ml-2 text-sm text-ink-muted">
                          {r.cliente} · {r.modelo}
                        </span>
                        <div className="text-xs text-ink-muted/80">
                          {r.asesor && r.asesor !== "(sin asesor)" ? `Asesor: ${r.asesor} · ` : ""}
                          {etiquetasCategorias(r.causasRaiz)} · {r.estado.replace("_", " ")}
                        </div>
                      </div>
                      <Badge tono={r.diasAbierto >= 7 ? "rojo" : "amarillo"} className="shrink-0" title="Días desde la apertura">
                        {r.diasAbierto} día(s)
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Origen del agendamiento */}
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-ink">Origen del agendamiento</h3>
              <div className="space-y-2" role="img" aria-label="Casos por origen del agendamiento">
                {resumen.porOrigen.map((o) => (
                  <div key={o.origen} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-right text-xs text-ink-muted">
                      {ETIQUETA_ORIGEN[o.origen] ?? o.origen}
                    </span>
                    <div className="h-6 flex-1">
                      <div
                        className="h-6 rounded-r"
                        style={{
                          width: `${Math.max(3, (o.total / maxOrigen) * 100)}%`,
                          backgroundColor: "#3E7CB1",
                          minWidth: 8,
                        }}
                        title={`${o.total} casos`}
                      />
                    </div>
                    <span className="w-36 shrink-0 text-sm text-ink">
                      <span className="font-medium">{o.total}</span>
                      <span className="ml-1 text-xs text-ink-muted">
                        {o.tasaRespuesta !== null ? `· ${o.tasaRespuesta}% respuesta` : "· sin contactados"}
                      </span>
                    </span>
                  </div>
                ))}
                {resumen.porOrigen.length === 0 && (
                  <p className="py-4 text-center text-sm text-ink-muted">Todavía no hay casos en este período.</p>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Estado de backups (solo ADMIN) ----------

interface EstadoBackup {
  configurado: boolean;
  mensaje?: string;
  ultimoBackup: { fecha: string; ok: boolean; archivo: string | null; tamanoBytes: number; subidoAOffsite: boolean; mensaje: string } | null;
  ultimaVerificacion: { fecha: string; ok: boolean; filasCaso: number; mensaje: string } | null;
  // El respaldo diario a OneDrive: el único que deja la copia FUERA de esta PC.
  respaldoNube: {
    fecha: string | null;
    ok: boolean;
    archivo: string | null;
    bytes: number;
    bases: Array<{ base: string; archivo: string; bytes: number }>;
    destinos: string[];
    rutas: string[];
    error: string | null;
    horas: number | null;
    vencido: boolean;
  } | null;
  mensajeRespaldoNube?: string;
}

function haceCuanto(horas: number | null): string {
  if (horas === null) return "";
  if (horas < 1) return "recién";
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return `hace ${dias} día${dias === 1 ? "" : "s"}`;
}

function fechaHoraCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function EstadoBackupCard() {
  const [estado, setEstado] = useState<EstadoBackup | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiGet<EstadoBackup>("/api/sistema/estado-backup")
      .then(setEstado)
      .catch(() => setError(true));
  }, []);

  if (error) return null; // no estorbar el dashboard si el endpoint no responde
  if (!estado) return null;

  const b = estado.ultimoBackup;
  const v = estado.ultimaVerificacion;
  const n = estado.respaldoNube;

  return (
    <Card>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        <DatabaseBackup className="h-4 w-4 text-accent" aria-hidden="true" />
        Estado de los backups
      </h3>

      {/* PRIMERO el respaldo a OneDrive: es el único que sobrevive a que se rompa
          el disco de esta PC. El de abajo (contenedor de Docker) copia al mismo
          disco, y durante meses fue lo único que se mostraba acá: el Dashboard
          decía "no hay registros" mientras el respaldo de verdad estaba muerto. */}
      <div
        className={`mb-3 rounded-md border p-3 ${
          n && !n.vencido ? "border-gray-100" : "border-red-200 bg-red-50"
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase text-ink-muted">Copia diaria a OneDrive</span>
          <Badge tono={n && !n.vencido ? "verde" : "rojo"}>
            {!n ? "Sin datos" : n.ok ? (n.vencido ? "Atrasado" : "OK") : "Falló"}
          </Badge>
        </div>
        {n ? (
          <>
            <div className="mt-1 text-sm text-ink">
              {fechaHoraCorta(n.fecha)} {n.horas !== null && <span className="text-ink-muted">({haceCuanto(n.horas)})</span>}
            </div>
            <div className="text-xs text-ink-muted">
              {n.ok
                ? `${n.destinos.join(" y ")} · ${n.bases.length} base(s) · ${(n.bytes / 1_048_576).toFixed(1)} MB`
                : "La copia NO salió de esta PC."}
            </div>
            {n.error && <div className="mt-1 text-xs text-red-700">{n.error}</div>}
            {n.ok && n.vencido && (
              <div className="mt-1 text-xs text-red-700">
                Pasaron más de 3 días desde el último respaldo. Fijate que la PC quede prendida al mediodía y que
                OneDrive tenga la sesión iniciada.
              </div>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">
            {estado.mensajeRespaldoNube ?? "Todavía no hay ningún registro del respaldo diario."}
          </p>
        )}
      </div>

      {!estado.configurado && !b ? (
        <p className="text-sm text-ink-muted">
          {estado.mensaje ?? "Todavía no hay registros de backup."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-gray-100 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-ink-muted">Último backup</span>
              <Badge tono={b?.ok ? "verde" : "rojo"}>{b?.ok ? "OK" : "Falló"}</Badge>
            </div>
            <div className="mt-1 text-sm text-ink">{fechaHoraCorta(b?.fecha)}</div>
            <div className="text-xs text-ink-muted">
              {b
                ? `${b.subidoAOffsite ? "Copiado a almacenamiento externo" : "Solo copia local"} · ${(b.tamanoBytes / 1_048_576).toFixed(1)} MB`
                : "sin datos"}
            </div>
          </div>
          <div className="rounded-md border border-gray-100 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-ink-muted">Última verificación</span>
              <Badge tono={v ? (v.ok ? "verde" : "rojo") : "gris"}>{v ? (v.ok ? "OK" : "Falló") : "Sin datos"}</Badge>
            </div>
            <div className="mt-1 text-sm text-ink">{fechaHoraCorta(v?.fecha)}</div>
            <div className="text-xs text-ink-muted">{v?.mensaje ?? "Aún no se corrió una verificación de integridad."}</div>
          </div>
        </div>
      )}
    </Card>
  );
}

const PUNTO_COLOR: Record<string, string> = {
  VERDE: "bg-semaforo-verde",
  AMARILLO: "bg-semaforo-amarillo",
  ROJO: "bg-semaforo-rojo",
};

function Kpi({
  titulo,
  valor,
  sufijo = "",
  detalle,
  color,
  punto,
  decimales = 0,
}: {
  titulo: string;
  valor: number;
  sufijo?: string;
  detalle: string;
  color: string;
  punto?: "VERDE" | "AMARILLO" | "ROJO";
  /**
   * Cuántos decimales mostrar. CERO para lo que se cuenta (casos, RQR); DOS para
   * promedios y porcentajes.
   *
   * Antes esto no existía y todo se dibujaba con Math.round: el promedio de 4,94
   * aparecía como 5 —"todos perfectos"— con un 94% de cinco estrellas. Se perdía
   * justo el decimal que dice que hay algo que mejorar.
   */
  decimales?: number;
}) {
  return (
    <Card>
      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        {punto && <span className={`inline-block h-1.5 w-1.5 rounded-full ${PUNTO_COLOR[punto]}`} aria-hidden="true" />}
        {titulo}
      </div>
      <div className={`font-display text-2xl font-bold ${color}`}>
        <AnimatedNumber value={valor} formatear={(v) => `${numero(v, decimales)}${sufijo}`} />
      </div>
      <div className="truncate text-xs text-ink-muted">{detalle}</div>
    </Card>
  );
}

function MiniKpi({ titulo, valor, color }: { titulo: string; valor: number | string; color: string }) {
  return (
    <div className="rounded-md border border-gray-100 p-2 text-center">
      <div className="text-[11px] text-ink-muted">{titulo}</div>
      <div className={`font-display text-lg font-bold ${color}`}>{valor}</div>
    </div>
  );
}

function BadgeRojos({ pct }: { pct: number }) {
  return <Badge tono={pct >= 30 ? "rojo" : pct >= 10 ? "amarillo" : "verde"}>{porcentaje(pct)}</Badge>;
}

function TablaRanking({
  titulo,
  filas,
  minimo,
  porEstrellas = false,
}: {
  titulo: string;
  filas: Ranking[];
  minimo: number;
  porEstrellas?: boolean;
}) {
  const hayPocos = filas.some((f) => f.total < minimo);
  return (
    <Card>
      <h3 className="mb-2 flex items-center justify-between text-sm font-semibold text-ink">
        <span>{titulo}</span>
        {filas.length > 0 && <span className="text-xs font-normal text-ink-muted">{filas.length}</span>}
      </h3>
      {/* Scroll interno: la lista puede ser larga (están todos) */}
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b text-xs uppercase text-ink-muted">
              <th className="px-2 py-1.5 text-left">Nombre</th>
              {porEstrellas ? (
                <>
                  <th className="px-2 py-1.5 text-right">Casos</th>
                  <th className="px-2 py-1.5 text-right">% 5★</th>
                  <th className="px-2 py-1.5 text-right">Promedio</th>
                </>
              ) : (
                <>
                  <th className="px-2 py-1.5 text-right">Verdes</th>
                  <th className="px-2 py-1.5 text-right">Amar.</th>
                  <th className="px-2 py-1.5 text-right">Rojos</th>
                  <th className="px-2 py-1.5 text-right">Total</th>
                  <th className="px-2 py-1.5 text-right">% Rojos</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const pocos = f.total < minimo;
              return (
                <tr key={f.nombre} className="border-b border-gray-100">
                  <td className="px-2 py-1.5 text-ink">
                    {f.nombre}
                    {pocos && (
                      <span className="ml-1 text-[10px] text-ink-muted" title={`Pocos casos (menos de ${minimo}): el % puede no ser representativo.`}>
                        ·pocos
                      </span>
                    )}
                  </td>
                  {porEstrellas ? (
                    <>
                      <td className="px-2 py-1.5 text-right text-ink-muted">{f.total}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{porcentaje(f.pctCinco)}</td>
                      <td className="px-2 py-1.5 text-right font-medium text-ink">
                        {f.promedioEstrellas !== null ? `${promedio(f.promedioEstrellas)} ★` : "—"}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-1.5 text-right text-ink-muted">{f.VERDE}</td>
                      <td className="px-2 py-1.5 text-right text-ink-muted">{f.AMARILLO}</td>
                      <td className="px-2 py-1.5 text-right text-ink-muted">{f.ROJO}</td>
                      <td className="px-2 py-1.5 text-right text-ink-muted">{f.total}</td>
                      <td className="px-2 py-1.5 text-right">
                        {pocos ? <span className="text-xs tabular-nums text-ink-muted">{porcentaje(f.pctRojos)}</span> : <BadgeRojos pct={f.pctRojos} />}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-xs text-ink-muted">
                  Todavía no hay casos clasificados en el período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {hayPocos && (
        <p className="mt-1.5 text-[11px] text-ink-muted">
          "·pocos" = menos de {minimo} casos; el % de rojos puede no ser representativo.
        </p>
      )}
    </Card>
  );
}

/**
 * Un escalón del embudo de contactos.
 *
 * Se muestran los cinco SIEMPRE, incluso en cero: un escalón vacío es
 * información —"a nadie le falta la llamada"— y esconderlo haría que el embudo
 * cambie de forma cada vez que se mira, que es justo lo contrario de lo que
 * sirve para seguir algo en el tiempo.
 */
function PasoCircuito({
  titulo,
  valor,
  detalle,
  clase,
}: {
  titulo: string;
  valor: number;
  detalle: string;
  clase: string;
}) {
  return (
    <div className={`rounded-lg px-3 py-2.5 transition-colors ${clase}`}>
      <div className="text-2xl font-bold tabular-nums">{valor}</div>
      <div className="text-xs font-semibold">{titulo}</div>
      <div className="mt-0.5 text-[11px] opacity-75">{detalle}</div>
    </div>
  );
}

/**
 * Cómo van las animaciones de encuestas de fábrica, mes a mes (Volkswagen).
 *
 * El número que manda es la efectividad: de los clientes animados, cuántos
 * respondieron, y se lee mes contra mes y vendedor contra vendedor. NO se la
 * compara con "los que respondieron sin animación": ese grupo no es comparable
 * (ver seguimiento-encuesta-vw.service.ts) y la comparación hacía parecer que
 * animar empeoraba las cosas.
 */
function AnimacionesMesAMes({ seguimiento }: { seguimiento: SeguimientoEncuestas }) {
  const t = seguimiento.total;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Animaciones de encuestas, mes a mes</h3>
        <Link to="/encuestas-fabrica" className="text-xs font-medium text-accent-dark hover:underline">
          Ver el detalle →
        </Link>
      </div>
      {/* Aclaración necesaria: el tablero tiene un rango de fechas arriba y este
          bloque NO lo usa. Sin decirlo, alguien achica el rango y espera que esto
          cambie. La sucursal sí lo acota. */}
      <p className="mt-1 text-xs text-ink-muted">
        Cada mes son los clientes que patentaron ese mes, según la Fecha Dominio del Excel de fábrica. No usa el rango de
        fechas de arriba. Muestra las dos provincias, salvo que elijas una sucursal en el filtro.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MiniKpi titulo="Efectividad de la animación" valor={porcentaje(t.efectividadAnimacion)} color="text-green-700" />
        <MiniKpi titulo="Clientes animados" valor={t.animados} color="text-accent-dark" />
        <MiniKpi titulo="Parte animada" valor={porcentaje(t.coberturaAnimacion)} color="text-accent-dark" />
        <MiniKpi titulo="Respondieron por su cuenta" valor={t.respondieronSinAnimar} color="text-ink" />
      </div>

      {seguimiento.meses.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          Todavía no hay clientes con mes. Se completa sola con la próxima carga del Excel de fábrica.
        </p>
      ) : (
        // min-w-0 en cada columna: sin eso, una columna de grilla toma el ancho
        // MINIMO de su contenido y en el celular las tablas empujan la tarjeta
        // entera fuera de la pantalla en vez de scrollear adentro.
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div className="min-w-0">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Clientes por mes</h4>
            <BarrasAnimacionPorMes meses={seguimiento.meses} />
          </div>
          <div className="min-w-0">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Vendedores que mejor animan
            </h4>
            <RankingVendedoresAnimacion vendedores={seguimiento.vendedores} minimo={seguimiento.minimoRanking} compacto />
          </div>
          <div className="min-w-0 lg:col-span-2">
            <TablaAnimacionPorMes meses={seguimiento.meses} total={t} />
          </div>
        </div>
      )}
    </Card>
  );
}
