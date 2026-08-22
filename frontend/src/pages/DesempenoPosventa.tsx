// Desempeño de Posventa (Volkswagen).
//
// Es el reporte de sentimiento pero mirado por ÍTEM. La pregunta que contesta no
// es "cuántos clientes quedaron conformes" sino "qué parte del circuito está
// fallando": el trato, la organización, la reparación o el lavado.
//
// Todo lo que se ve acá es lo mismo que sale en las exportaciones a Excel y a
// Word, porque sale del mismo cálculo del backend.
import { useCallback, useEffect, useState } from "react";
import { FileDown, FileText } from "lucide-react";
import { apiDescargarArchivo, apiGet } from "../lib/api";
import { getMarca } from "../lib/marca";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { claseBoton } from "../components/ui/Button";
import { Campo, Input, Select } from "../components/ui/Field";
import { EmptyState } from "../components/ui/EmptyState";
import { SkeletonBlock } from "../components/ui/Skeleton";

interface ResumenItem {
  item: string;
  etiqueta: string;
  descripcion: string;
  respuestas: number;
  promedio: number | null;
  distribucion: Record<string, number>;
  porcentajeCinco: number | null;
  porcentajeMalos: number | null;
}

interface Grupo {
  nombre: string;
  respuestas: number;
  promedioGeneral: number | null;
  porItem: Record<string, number | null>;
}

interface Reporte {
  clientesQueContestaron: number;
  items: ResumenItem[];
  itemMasFlojo: { item: string; etiqueta: string; promedio: number } | null;
  porAsesor: Grupo[];
  porSucursal: Grupo[];
  comentarios: Array<{
    item: string;
    etiqueta: string;
    estrellas: number | null;
    comentario: string;
    cliente: string;
    sucursal: string;
    asesor: string;
    fecha: string;
  }>;
  detalle: Array<{
    numeroOrden: string;
    cliente: string;
    sucursal: string;
    asesor: string;
    modelo: string;
    fecha: string;
    puntajes: Record<string, number | null>;
  }>;
}

/** Color del promedio: verde de 4,5 para arriba, rojo abajo de 3,5. */
function colorPromedio(v: number | null): string {
  if (v === null) return "text-ink-muted";
  if (v >= 4.5) return "text-green-700";
  if (v >= 3.5) return "text-yellow-700";
  return "text-red-700";
}

function Estrellas({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-ink-muted">—</span>;
  return (
    <span className={`font-semibold ${colorPromedio(valor)}`}>
      {valor.toFixed(2).replace(".", ",")} <span className="text-xs font-normal text-ink-muted">/ 5</span>
    </span>
  );
}

/** Barra de distribución 1..5 dentro de un ítem. */
function Distribucion({ d, total }: { d: Record<string, number>; total: number }) {
  if (total === 0) return null;
  const colores: Record<string, string> = {
    "1": "bg-red-600",
    "2": "bg-red-400",
    "3": "bg-yellow-400",
    "4": "bg-green-400",
    "5": "bg-green-600",
  };
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
      {["1", "2", "3", "4", "5"].map((k) =>
        d[k] > 0 ? (
          <div
            key={k}
            className={colores[k]}
            style={{ width: `${(d[k] / total) * 100}%` }}
            title={`${d[k]} cliente(s) pusieron ${k}`}
          />
        ) : null
      )}
    </div>
  );
}

export default function DesempenoPosventa() {
  const marca = getMarca();
  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState<"excel" | "word" | null>(null);
  const [filtros, setFiltros] = useState({ fechaDesde: "", fechaHasta: "", sucursal: "", asesor: "" });

  const params = useCallback(() => {
    const p = new URLSearchParams();
    if (filtros.fechaDesde) p.set("fechaDesde", filtros.fechaDesde);
    if (filtros.fechaHasta) p.set("fechaHasta", filtros.fechaHasta);
    if (filtros.sucursal.trim()) p.set("sucursal", filtros.sucursal.trim());
    if (filtros.asesor.trim()) p.set("asesor", filtros.asesor.trim());
    return p.toString();
  }, [filtros]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await apiGet<{ data: Reporte }>(`/api/posventa/desempeno?${params()}`);
      setReporte(r.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar el desempeño de Posventa.");
    } finally {
      setCargando(false);
    }
  }, [params]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function exportar(formato: "excel" | "word") {
    setExportando(formato);
    setError(null);
    try {
      const ext = formato === "excel" ? "xlsx" : "docx";
      await apiDescargarArchivo(`/api/posventa/desempeno/${formato}?${params()}`, `desempeno-posventa.${ext}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos exportar el reporte.");
    } finally {
      setExportando(null);
    }
  }

  if (!marca.modulos.desempenoPosventa) {
    return <Alert tono="info">Esta pantalla es de {marca.nombre}. En esta marca no aplica.</Alert>;
  }

  const hayDatos = (reporte?.clientesQueContestaron ?? 0) > 0;

  return (
    <div className="space-y-4">
      {error && <Alert tono="error">{error}</Alert>}

      {/* Filtros + exportación */}
      <Card padding="p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Campo etiqueta="Desde">
            <Input type="date" value={filtros.fechaDesde} onChange={(e) => setFiltros({ ...filtros, fechaDesde: e.target.value })} />
          </Campo>
          <Campo etiqueta="Hasta">
            <Input type="date" value={filtros.fechaHasta} onChange={(e) => setFiltros({ ...filtros, fechaHasta: e.target.value })} />
          </Campo>
          <Campo etiqueta="Sucursal">
            <Select value={filtros.sucursal} onChange={(e) => setFiltros({ ...filtros, sucursal: e.target.value })}>
              <option value="">Todas</option>
              {(reporte?.porSucursal ?? []).map((s) => (
                <option key={s.nombre} value={s.nombre}>
                  {s.nombre}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo etiqueta="Asesor">
            <Select value={filtros.asesor} onChange={(e) => setFiltros({ ...filtros, asesor: e.target.value })}>
              <option value="">Todos</option>
              {(reporte?.porAsesor ?? []).map((a) => (
                <option key={a.nombre} value={a.nombre}>
                  {a.nombre}
                </option>
              ))}
            </Select>
          </Campo>
          <div className="flex items-end gap-2">
            <button onClick={() => exportar("excel")} disabled={!hayDatos || exportando !== null} className={claseBoton("secundario", "!py-2")}>
              <FileDown className="h-4 w-4" /> {exportando === "excel" ? "…" : "Excel"}
            </button>
            <button onClick={() => exportar("word")} disabled={!hayDatos || exportando !== null} className={claseBoton("secundario", "!py-2")}>
              <FileText className="h-4 w-4" /> {exportando === "word" ? "…" : "Word"}
            </button>
          </div>
        </div>
      </Card>

      {cargando ? (
        <div className="space-y-3">
          <SkeletonBlock className="h-24 w-full" />
          <SkeletonBlock className="h-64 w-full" />
        </div>
      ) : !hayDatos ? (
        <Card padding="p-0">
          <EmptyState
            icono={FileText}
            titulo="Todavía no hay encuestas de Posventa contestadas"
            descripcion="Cuando un cliente apriete “Quiero participar por WhatsApp” y conteste las 5 preguntas, sus puntajes aparecen acá."
          />
        </Card>
      ) : (
        <>
          {/* Titular: el ítem más flojo */}
          {reporte?.itemMasFlojo && (
            <Card padding="p-5">
              <div className="text-xs uppercase tracking-wide text-ink-muted">Lo más flojo del período</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-3">
                <span className="font-display text-2xl font-bold text-navy">{reporte.itemMasFlojo.etiqueta}</span>
                <span className={`text-xl font-bold ${colorPromedio(reporte.itemMasFlojo.promedio)}`}>
                  {reporte.itemMasFlojo.promedio.toFixed(2).replace(".", ",")} / 5
                </span>
                <span className="text-sm text-ink-muted">
                  sobre {reporte.clientesQueContestaron} cliente(s) que contestaron
                </span>
              </div>
            </Card>
          )}

          {/* Puntaje por ítem */}
          <Card padding="p-5">
            <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-navy">Puntaje por ítem</h3>
            <div className="space-y-4">
              {(reporte?.items ?? []).map((i) => (
                <div key={i.item}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="font-medium text-ink">{i.etiqueta}</span>
                      <span className="ml-2 text-xs text-ink-muted">{i.descripcion}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <Estrellas valor={i.promedio} />
                      <span className="text-xs text-ink-muted">{i.respuestas} respuesta(s)</span>
                      {i.porcentajeMalos !== null && i.porcentajeMalos > 0 && (
                        <span className="text-xs text-red-700">{i.porcentajeMalos}% en 1 o 2</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1">
                    <Distribucion d={i.distribucion} total={i.respuestas} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-ink-muted">
              Cada ítem se puntúa por separado: un cliente puede estar conforme con la atención y disconforme con el
              lavado. Los ítems que el cliente no contestó no cuentan en el promedio.
            </p>
          </Card>

          {/* Por asesor y por sucursal */}
          {(["porAsesor", "porSucursal"] as const).map((clave) => {
            const datos = reporte?.[clave] ?? [];
            if (datos.length === 0) return null;
            return (
              <Card key={clave} padding="p-5">
                <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-navy">
                  {clave === "porAsesor" ? "Por asesor" : "Por sucursal"}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                        <th className="py-2 pr-4">{clave === "porAsesor" ? "Asesor" : "Sucursal"}</th>
                        <th className="py-2 pr-4">Clientes</th>
                        {marca.posventa.items.map((d) => (
                          <th key={d.item} className="py-2 pr-4">
                            {d.etiqueta}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {datos.map((g) => (
                        <tr key={g.nombre} className="border-t border-gray-100">
                          <td className="py-2 pr-4 font-medium text-ink">{g.nombre}</td>
                          <td className="py-2 pr-4 text-ink-muted">{g.respuestas}</td>
                          {marca.posventa.items.map((d) => (
                            <td key={d.item} className="py-2 pr-4">
                              <Estrellas valor={g.porItem[d.item] ?? null} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-ink-muted">Ordenado por satisfacción general, del más bajo al más alto.</p>
              </Card>
            );
          })}

          {/* Comentarios */}
          {(reporte?.comentarios.length ?? 0) > 0 && (
            <Card padding="p-5">
              <h3 className="mb-1 font-display text-sm font-bold uppercase tracking-wide text-navy">
                Lo que dijeron los clientes
              </h3>
              <p className="mb-3 text-xs text-ink-muted">Del peor puntaje al mejor: son los que hay que leer primero.</p>
              <div className="space-y-2">
                {(reporte?.comentarios ?? []).slice(0, 30).map((c, i) => (
                  <div key={i} className="border-l-2 border-gray-200 pl-3 text-sm">
                    <div>
                      <span className={`font-semibold ${colorPromedio(c.estrellas)}`}>
                        {c.etiqueta} {c.estrellas ?? "—"}/5
                      </span>
                      <span className="ml-2 text-ink">“{c.comentario}”</span>
                    </div>
                    <div className="text-xs text-ink-muted">
                      {c.cliente} · {c.sucursal} · {c.asesor} · {c.fecha}
                    </div>
                  </div>
                ))}
              </div>
              {(reporte?.comentarios.length ?? 0) > 30 && (
                <p className="mt-3 text-xs text-ink-muted">
                  Se muestran los 30 peores. Están todos en la exportación a Excel.
                </p>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
