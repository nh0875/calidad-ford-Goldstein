// Cierre de meses de las encuestas de fábrica (Ventas y PV).
//
// Pedido de Calidad del 17-09-2026: los clientes de cada mes se CIERRAN y dejan la
// lista de trabajo (ocupaban lugar y confundían), pero se pueden volver a consultar.
// Se cierra por mes y por provincia con el botón, o solo el día 19 del mes
// siguiente. Reabre un administrador. Lo que decide todo eso está en el backend
// (services/cierre-periodo.service.ts); acá solo se muestra y se piden las acciones.
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Lock, LockOpen } from "lucide-react";
import { apiGet, apiPostJson } from "../lib/api";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { claseBoton } from "./ui/Button";
import { etiquetaMes } from "./SeguimientoAnimaciones";

export interface MesDeLaLista {
  periodo: string;
  sucursal: string;
  enLista: number;
  cerrados: number;
  cierre: {
    activo: boolean;
    origen: "MANUAL" | "AUTOMATICO";
    cerradoEn: string;
    cerradoPorNombre: string | null;
    reabiertoEn: string | null;
    reabiertoPorNombre: string | null;
  } | null;
}

interface RespuestaMeses {
  data: MesDeLaLista[];
  periodoActual: string;
  permisos: { cerrar: boolean; reabrir: boolean; provincia: string | null };
}

const CLIENTES_POR_PAGINA = 25;

function fecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

const mismaSucursal = (a: string, b: string) =>
  a.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase() ===
  b.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export default function CierreDeMeses<T extends { id: string }>({
  base,
  sucursalFiltro = "",
  cambio,
  onCambio,
  renderClientes,
}: {
  /** "/api/encuesta-vw" o "/api/encuesta-pv". */
  base: string;
  /** La sucursal elegida arriba en la pantalla ("" = las dos). */
  sucursalFiltro?: string;
  /** Sube cuando la lista de la pantalla cambió, para recontar. */
  cambio?: number;
  /** Después de cerrar o reabrir: la pantalla vuelve a pedir su lista. */
  onCambio: () => void;
  /** Cómo se muestran los clientes de un mes cerrado (solo lectura). */
  renderClientes: (clientes: T[]) => ReactNode;
}) {
  const [meses, setMeses] = useState<RespuestaMeses | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // El error de traer los meses va aparte: se borra solo con la próxima carga que ande,
  // sin tapar el de una acción (cerrar, reabrir).
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  // La consulta de un mes cerrado.
  const [consulta, setConsulta] = useState<{ periodo: string; sucursal: string; data: T[] } | null>(null);
  const [pagina, setPagina] = useState(1);

  const cargar = useCallback(async () => {
    try {
      setMeses(await apiGet<RespuestaMeses>(`${base}/cierres`));
      setErrorCarga(null);
    } catch (err) {
      setErrorCarga(err instanceof Error ? err.message : "No pudimos cargar los meses.");
    }
  }, [base]);

  useEffect(() => {
    cargar();
  }, [cargar, cambio]);

  // Los meses que el cierre automático cerró sin clientes no se muestran: no hay nada
  // que ver ni que hacer. Si después llega alguno, aparecen.
  const visibles = useMemo(
    () =>
      (meses?.data ?? []).filter(
        (m) => (m.enLista > 0 || m.cerrados > 0) && (!sucursalFiltro || mismaSucursal(m.sucursal, sucursalFiltro))
      ),
    [meses, sucursalFiltro]
  );
  // Lo que conviene ver sin abrir: meses cerrados con clientes que llegaron después.
  const conLlegadosTarde = visibles.filter((m) => m.cierre?.activo && m.enLista > 0);
  const abiertosViejos = visibles.filter((m) => !m.cierre?.activo && meses && m.periodo < meses.periodoActual && m.enLista > 0);

  const puedeTocar = (m: MesDeLaLista) =>
    !meses?.permisos.provincia || mismaSucursal(meses.permisos.provincia, m.sucursal);

  async function cerrar(m: MesDeLaLista) {
    const yaCerrado = m.cierre?.activo;
    const ok = window.confirm(
      yaCerrado
        ? `${etiquetaMes(m.periodo)} de ${m.sucursal} ya está cerrado.\n\n¿Guardar también a los ${m.enLista} cliente(s) que llegaron después? Salen de la lista y quedan para consultar.`
        : `¿Cerrar ${etiquetaMes(m.periodo)} de ${m.sucursal}?\n\n${m.enLista} cliente(s) salen de la lista de trabajo y de los avisos. Se pueden consultar desde este panel, pero no cambiarlos: para eso un administrador tiene que reabrir el mes.`
    );
    if (!ok) return;
    await accion(`cerrar-${m.periodo}-${m.sucursal}`, `${base}/cierres`, m);
  }

  async function reabrir(m: MesDeLaLista) {
    const ok = window.confirm(
      `¿Reabrir ${etiquetaMes(m.periodo)} de ${m.sucursal}?\n\nSus ${m.cerrados} cliente(s) vuelven a la lista de trabajo. El mes ya no se cierra solo el día 19: se vuelve a cerrar con el botón.`
    );
    if (!ok) return;
    await accion(`reabrir-${m.periodo}-${m.sucursal}`, `${base}/cierres/reabrir`, m);
  }

  async function accion(clave: string, url: string, m: MesDeLaLista) {
    setTrabajando(clave);
    setError(null);
    setMensaje(null);
    try {
      const r = await apiPostJson<{ message: string }>(url, { periodo: m.periodo, sucursal: m.sucursal });
      setMensaje(r.message);
      if (consulta && consulta.periodo === m.periodo && mismaSucursal(consulta.sucursal, m.sucursal)) setConsulta(null);
      await cargar();
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la acción.");
    } finally {
      setTrabajando(null);
    }
  }

  async function verClientes(m: MesDeLaLista) {
    if (consulta && consulta.periodo === m.periodo && mismaSucursal(consulta.sucursal, m.sucursal)) {
      setConsulta(null);
      return;
    }
    setTrabajando(`ver-${m.periodo}-${m.sucursal}`);
    setError(null);
    try {
      const r = await apiGet<{ data: T[] }>(
        `${base}/cierres/clientes?periodo=${m.periodo}&sucursal=${encodeURIComponent(m.sucursal)}`
      );
      setConsulta({ periodo: m.periodo, sucursal: m.sucursal, data: r.data });
      setPagina(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos traer los clientes de ese mes.");
    } finally {
      setTrabajando(null);
    }
  }

  if (!meses) {
    return errorCarga ? <p className="text-sm text-rojo">{errorCarga}</p> : null;
  }

  const totalPaginas = consulta ? Math.max(1, Math.ceil(consulta.data.length / CLIENTES_POR_PAGINA)) : 1;
  const paginaActual = Math.min(pagina, totalPaginas);
  const desde = (paginaActual - 1) * CLIENTES_POR_PAGINA;

  return (
    <Card padding="p-0">
      <button
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left"
        aria-expanded={abierto}
      >
        {abierto ? <ChevronDown className="h-4 w-4 text-ink-muted" /> : <ChevronRight className="h-4 w-4 text-ink-muted" />}
        <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy">Cierre de meses</h3>
        <span className="text-xs text-ink-muted">
          Los meses cerrados salen de la lista y se consultan acá. Se cierran solos el día 19 del mes siguiente.
        </span>
        {conLlegadosTarde.length > 0 && (
          <Badge tono="amarillo">
            {conLlegadosTarde.reduce((n, m) => n + m.enLista, 0)} llegaron a un mes ya cerrado
          </Badge>
        )}
        {abiertosViejos.length > 0 && <Badge tono="gris">{abiertosViejos.length} mes(es) anteriores abiertos</Badge>}
      </button>

      {(mensaje || error || errorCarga) && (
        <div className="px-5 pb-3">
          {mensaje && <p className="text-sm text-green-800">{mensaje}</p>}
          {error && <p className="text-sm text-rojo">{error}</p>}
          {errorCarga && <p className="text-sm text-rojo">{errorCarga}</p>}
        </div>
      )}

      {abierto && (
        <div className="border-t border-gray-200">
          {visibles.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-muted">Todavía no hay clientes con mes.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                    <th className="px-5 py-2">Mes</th>
                    <th className="px-3 py-2">Provincia</th>
                    <th className="px-3 py-2 text-right">En la lista</th>
                    <th className="px-3 py-2 text-right">Cerrados</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-5 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((m) => {
                    const clave = `${m.periodo}-${m.sucursal}`;
                    const cerrado = !!m.cierre?.activo;
                    const enConsulta =
                      consulta && consulta.periodo === m.periodo && mismaSucursal(consulta.sucursal, m.sucursal);
                    return (
                      <tr key={clave} className="border-b border-gray-100">
                        <td className="px-5 py-2 font-medium text-ink">
                          {etiquetaMes(m.periodo)}
                          {m.periodo === meses.periodoActual && (
                            <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">EN CURSO</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-ink">{m.sucursal}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {m.enLista}
                          {cerrado && m.enLista > 0 && (
                            <span className="ml-1 text-xs text-amber-700" title="Llegaron después de cerrar el mes">
                              (llegaron tarde)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.cerrados}</td>
                        <td className="px-3 py-2">
                          {cerrado ? (
                            <span className="inline-flex items-center gap-1 text-xs text-ink">
                              <Lock className="h-3.5 w-3.5 text-navy" aria-hidden="true" />
                              Cerrado el {fecha(m.cierre!.cerradoEn)}
                              {m.cierre!.origen === "AUTOMATICO" ? " (solo, día 19)" : m.cierre!.cerradoPorNombre ? ` por ${m.cierre!.cerradoPorNombre}` : ""}
                            </span>
                          ) : m.cierre?.reabiertoEn ? (
                            <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                              <LockOpen className="h-3.5 w-3.5" aria-hidden="true" />
                              Reabierto el {fecha(m.cierre.reabiertoEn)}
                              {m.cierre.reabiertoPorNombre ? ` por ${m.cierre.reabiertoPorNombre}` : ""}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-muted">Abierto</span>
                          )}
                        </td>
                        <td className="px-5 py-2">
                          <div className="flex flex-wrap justify-end gap-2">
                            {m.cerrados > 0 && (
                              <button
                                onClick={() => verClientes(m)}
                                disabled={trabajando !== null}
                                className={claseBoton("secundario", "!py-1 !px-2 !text-xs")}
                              >
                                {enConsulta ? "Ocultar clientes" : "Ver clientes"}
                              </button>
                            )}
                            {meses.permisos.cerrar && puedeTocar(m) && m.enLista > 0 && m.periodo <= meses.periodoActual && (
                              <button
                                onClick={() => cerrar(m)}
                                disabled={trabajando !== null}
                                className={claseBoton("secundario", "!py-1 !px-2 !text-xs")}
                              >
                                <Lock className="h-3.5 w-3.5" />
                                {trabajando === `cerrar-${clave}` ? "Cerrando…" : cerrado ? "Guardar los que llegaron" : "Cerrar mes"}
                              </button>
                            )}
                            {meses.permisos.reabrir && puedeTocar(m) && cerrado && (
                              <button
                                onClick={() => reabrir(m)}
                                disabled={trabajando !== null}
                                className={claseBoton("secundario", "!py-1 !px-2 !text-xs")}
                              >
                                <LockOpen className="h-3.5 w-3.5" />
                                {trabajando === `reabrir-${clave}` ? "Reabriendo…" : "Reabrir"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {consulta && (
            <div className="border-t border-gray-200 bg-gray-50">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <h4 className="text-sm font-semibold text-navy">
                  Clientes cerrados de {etiquetaMes(consulta.periodo)} · {consulta.sucursal} ({consulta.data.length})
                </h4>
                <span className="text-xs text-ink-muted">Solo lectura: para cambiarlos, un administrador reabre el mes.</span>
              </div>
              <div className="overflow-x-auto bg-white">
                {renderClientes(consulta.data.slice(desde, desde + CLIENTES_POR_PAGINA))}
              </div>
              {consulta.data.length > CLIENTES_POR_PAGINA && (
                <div className="flex flex-wrap items-center justify-center gap-2 px-5 py-3">
                  <button
                    onClick={() => setPagina(Math.max(1, paginaActual - 1))}
                    disabled={paginaActual <= 1}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-gray-50 disabled:opacity-40"
                  >
                    ← Anterior
                  </button>
                  <span className="text-sm text-ink-muted">
                    {desde + 1}–{Math.min(desde + CLIENTES_POR_PAGINA, consulta.data.length)} de {consulta.data.length} · página{" "}
                    {paginaActual} de {totalPaginas}
                  </span>
                  <button
                    onClick={() => setPagina(Math.min(totalPaginas, paginaActual + 1))}
                    disabled={paginaActual >= totalPaginas}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-gray-50 disabled:opacity-40"
                  >
                    Siguiente →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** ¿Este cliente es de un mes que ya está cerrado (llegó tarde)? */
export function esDeMesCerrado(
  periodo: string | null | undefined,
  sucursal: string | null | undefined,
  cerrados: Array<{ periodo: string; sucursal: string }> | undefined
): boolean {
  if (!periodo || !sucursal || !cerrados) return false;
  return cerrados.some((c) => c.periodo === periodo && mismaSucursal(c.sucursal, sucursal));
}
