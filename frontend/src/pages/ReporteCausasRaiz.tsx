import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, FileDown, SearchX } from "lucide-react";
import { apiDescargarArchivo, apiGet } from "../lib/api";
import { CATEGORIAS_CAUSA_RAIZ, etiquetaCategoria, fechaCorta } from "../lib/categorias";
import { BarraFiltros, CampoFiltro, FILTROS_VACIOS, FiltroSelect, FiltrosComunes, filtrosAQuery, useOpcionesCasos } from "../components/filtros";
import { getUsuario, veTodasLasAreas } from "../lib/auth";
import { BarrasCategorias } from "../components/graficos";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge, PuntoSemaforo } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";

interface ItemDetalle {
  origen: "RQR" | "AMARILLO_SIN_RQR";
  caso: {
    numeroOrden: string;
    nombrePropietario: string;
    whatsapp: string;
    celular: string;
    modelo: string;
    sucursal: string;
    asesor: string;
    fechaSalida: string | null;
    fechaProgramacion: string;
  };
  semaforo: string | null;
  severidad: string | null;
  categoria: string;
  rqr: { id: string; numeroRQR: string; estado: string } | null;
  resumenIA: string | null;
  textoCliente: string | null;
  fecha: string;
}

const SEVERIDAD_TONO: Record<string, "gris" | "amarillo" | "rojo"> = {
  LEVE: "gris",
  MODERADA: "amarillo",
  GRAVE: "rojo",
};

export function BadgeSeveridad({ severidad }: { severidad: string | null }) {
  if (!severidad) return null;
  return <Badge tono={SEVERIDAD_TONO[severidad] ?? "gris"}>{severidad.toLowerCase()}</Badge>;
}

interface Reporte {
  porCategoria: Array<{ categoria: string; total: number; conRqr: number; sinRqr: number }>;
  detalle: ItemDetalle[];
  tiempoCierre: {
    promedioDias: number | null;
    rqrCerrados: number;
    porCategoria: Array<{ categoria: string; promedioDias: number | null; cantidad: number }>;
  };
}

export default function ReporteCausasRaiz() {
  const [filtros, setFiltros] = useState<FiltrosComunes>(FILTROS_VACIOS);
  const [categoria, setCategoria] = useState("");
  const [incluirAmarillos, setIncluirAmarillos] = useState(true);
  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandida, setExpandida] = useState<number | null>(null);
  const [area, setArea] = useState("");
  const opciones = useOpcionesCasos();
  const mostrarArea = veTodasLasAreas(getUsuario());

  const query = useCallback(
    () =>
      filtrosAQuery(filtros, {
        categoria,
        incluirAmarilloSinRqr: incluirAmarillos ? "true" : "false",
        area,
      }),
    [filtros, categoria, incluirAmarillos, area]
  );

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setReporte(await apiGet<Reporte>(`/api/reportes/causa-raiz?${query()}`));
      setExpandida(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar el reporte. Probá recargar la página.");
    }
  }, [query]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="space-y-4">
      <BarraFiltros
        filtros={filtros}
        onChange={setFiltros}
        opciones={opciones}
        area={area}
        onAreaChange={setArea}
        mostrarArea={mostrarArea}
        onLimpiar={() => {
          setFiltros(FILTROS_VACIOS);
          setCategoria("");
          setIncluirAmarillos(true);
          setArea("");
        }}
      >
        <FiltroSelect
          etiqueta="Categoría"
          valor={categoria}
          opciones={CATEGORIAS_CAUSA_RAIZ.map((c) => ({ value: c, label: etiquetaCategoria(c) }))}
          onChange={setCategoria}
        />
        <CampoFiltro etiqueta="Amarillos sin RQR">
          <label className="flex h-[38px] cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={incluirAmarillos}
              onChange={(e) => setIncluirAmarillos(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Incluir
          </label>
        </CampoFiltro>
        <div className="flex items-end">
          <button
            onClick={() =>
              apiDescargarArchivo(`/api/reportes/causa-raiz/exportar?${query()}`, "reporte-causa-raiz.xlsx").catch(
                (err) => setError(err instanceof Error ? err.message : "No pudimos descargar el archivo.")
              )
            }
            className={claseBoton("secundario", "w-full")}
          >
            <FileDown className="h-4 w-4" aria-hidden="true" />
            Exportar a Excel
          </button>
        </div>
      </BarraFiltros>

      {error && <Alert tono="error">{error}</Alert>}

      {reporte && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <h3 className="mb-3 text-sm font-semibold text-ink">Casos por categoría de causa raíz</h3>
              <BarrasCategorias
                items={reporte.porCategoria.map((c) => ({
                  etiqueta: etiquetaCategoria(c.categoria),
                  conRqr: c.conRqr,
                  sinRqr: c.sinRqr,
                }))}
              />
            </Card>

            <Card>
              <div className="text-xs text-ink-muted">Tiempo promedio de cierre de RQR</div>
              <div className="font-display text-3xl font-bold text-accent-dark">
                {reporte.tiempoCierre.promedioDias !== null ? `${reporte.tiempoCierre.promedioDias} días` : "—"}
              </div>
              <div className="mb-3 text-xs text-ink-muted">sobre {reporte.tiempoCierre.rqrCerrados} RQR cerrado(s)</div>
              <table className="w-full text-sm">
                <tbody>
                  {reporte.tiempoCierre.porCategoria.map((c) => (
                    <tr key={c.categoria} className="border-t border-gray-100">
                      <td className="py-1 text-ink-muted">{etiquetaCategoria(c.categoria)}</td>
                      <td className="py-1 text-right font-medium text-ink">
                        {c.promedioDias !== null ? `${c.promedioDias} d` : "—"}
                        <span className="ml-1 text-xs font-normal text-ink-muted">({c.cantidad})</span>
                      </td>
                    </tr>
                  ))}
                  {reporte.tiempoCierre.porCategoria.length === 0 && (
                    <tr>
                      <td className="py-4 text-center text-ink-muted">Todavía no hay RQR cerrados.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </div>

          {/* Tabla detallada expandible */}
          <Card padding="p-0" className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
                  <th className="px-3 py-2 text-center"> </th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Teléfono</th>
                  <th className="px-3 py-2">Modelo</th>
                  <th className="px-3 py-2">Sucursal</th>
                  <th className="px-3 py-2">Asesor</th>
                  <th className="px-3 py-2">Servicio</th>
                  <th className="px-3 py-2 text-center">Semáforo</th>
                  <th className="px-3 py-2">Severidad</th>
                  <th className="px-3 py-2">Categoría</th>
                  <th className="px-3 py-2">RQR</th>
                </tr>
              </thead>
              <tbody>
                {reporte.detalle.map((item, i) => (
                  <Fragment key={`${item.caso.numeroOrden}-${item.fecha}-${i}`}>
                    <tr
                      className="cursor-pointer border-b border-gray-100 transition-colors hover:bg-gray-50"
                      onClick={() => setExpandida(expandida === i ? null : i)}
                      title="Clic para ver el detalle completo"
                    >
                      <td className="px-3 py-2 text-center text-ink-muted">
                        {expandida === i ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{fechaCorta(item.fecha)}</td>
                      <td className="px-3 py-2 text-ink">{item.caso.nombrePropietario}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-muted">
                        {item.caso.whatsapp || item.caso.celular || "—"}
                      </td>
                      <td className="px-3 py-2 text-ink-muted">{item.caso.modelo}</td>
                      <td className="px-3 py-2 text-ink-muted">{item.caso.sucursal}</td>
                      <td className="px-3 py-2 text-ink-muted">{item.caso.asesor}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-muted">
                        {fechaCorta(item.caso.fechaSalida ?? item.caso.fechaProgramacion)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <PuntoSemaforo semaforo={item.semaforo} soloIcono />
                      </td>
                      <td className="px-3 py-2"><BadgeSeveridad severidad={item.severidad} /></td>
                      <td className="px-3 py-2 text-ink-muted">{etiquetaCategoria(item.categoria)}</td>
                      <td className="px-3 py-2">
                        {item.rqr ? (
                          <Link to={`/rqr/${item.rqr.id}`} onClick={(e) => e.stopPropagation()} title={`Abrir ${item.rqr.numeroRQR}`}>
                            <Badge tono={item.rqr.estado === "CERRADO" ? "gris" : "rojo"} className="hover:underline">
                              {item.rqr.numeroRQR}
                            </Badge>
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-muted">sin RQR</span>
                        )}
                      </td>
                    </tr>
                    {expandida === i && (
                      <tr className="border-b border-gray-100 bg-accent-light/50">
                        <td colSpan={12} className="px-6 py-3">
                          <div className="grid gap-3 lg:grid-cols-2">
                            <div>
                              <div className="text-xs font-semibold uppercase text-ink-muted">Respuesta del cliente</div>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                                {item.textoCliente ?? "(sin texto asociado)"}
                              </p>
                            </div>
                            <div>
                              <div className="text-xs font-semibold uppercase text-ink-muted">Resumen del análisis</div>
                              <p className="mt-1 text-sm text-ink">{item.resumenIA ?? "(sin resumen)"}</p>
                              <div className="mt-2 text-xs text-ink-muted">
                                Orden {item.caso.numeroOrden} · Origen: {item.origen === "RQR" ? "RQR" : "amarillo sin RQR"}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {reporte.detalle.length === 0 && (
                  <tr>
                    <td colSpan={12}>
                      <EmptyState
                        icono={SearchX}
                        titulo="No encontramos casos con estos filtros"
                        descripcion="Probá ajustar el rango de fechas o la categoría."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
