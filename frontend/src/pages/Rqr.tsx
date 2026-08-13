import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FilePlus2, FileUp, SearchX } from "lucide-react";
import { apiGet, apiPostForm } from "../lib/api";
import { CATEGORIAS_CAUSA_RAIZ, etiquetaCategoria, fechaCorta } from "../lib/categorias";
import { BarraFiltros, FILTROS_VACIOS, FiltroSelect, FiltrosComunes, filtrosAQuery, useOpcionesCasos } from "../components/filtros";
import { getUsuario, veTodasLasAreas } from "../lib/auth";
import { etiquetaArea, tonoArea } from "../lib/area";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge, PuntoSemaforo } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { SkeletonTableRows } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";

interface FilaRqr {
  id: string;
  numeroRQR: string;
  fechaApertura: string;
  causaRaiz: string | null;
  estado: string;
  area: string;
  asesor: string;
  caso: { numeroOrden: string; nombrePropietario: string; modelo: string; sucursal: string } | null;
  nombreClienteManual: string | null;
  modeloManual: string | null;
  sentimentAnalysis: { semaforo: string | null; estrellas: number | null } | null;
}

interface Respuesta {
  data: FilaRqr[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

const BADGE_ESTADO: Record<string, "rojo" | "amarillo" | "gris"> = {
  ABIERTO: "rojo",
  EN_TRATAMIENTO: "amarillo",
  CERRADO: "gris",
};

function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default function Rqr() {
  const [filtros, setFiltros] = useState<FiltrosComunes>(FILTROS_VACIOS);
  const [estado, setEstado] = useState("");
  const [categoria, setCategoria] = useState("");
  const [area, setArea] = useState("");
  const [page, setPage] = useState(1);
  const mostrarArea = veTodasLasAreas(getUsuario());
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opciones = useOpcionesCasos();
  const [importResultado, setImportResultado] = useState<{ message: string; resultados: Array<{ hoja: string; ok: boolean; mensaje: string }> } | null>(null);
  const [importando, setImportando] = useState(false);
  const inputImport = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = filtrosAQuery(filtros, { estado, categoria, area, page: String(page), pageSize: "20" });
      params.delete("periodo"); // el listado de RQR filtra por fecha de apertura, no por período de carga
      setRespuesta(await apiGet<Respuesta>(`/api/rqr?${params}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar el listado. Probá recargar la página.");
    } finally {
      setCargando(false);
    }
  }, [filtros, estado, categoria, area, page]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="space-y-4">
      <BarraFiltros
        filtros={filtros}
        onChange={(f) => {
          setFiltros(f);
          setPage(1);
        }}
        opciones={opciones}
        ocultarPeriodo
        area={area}
        onAreaChange={(v) => {
          setArea(v);
          setPage(1);
        }}
        mostrarArea={mostrarArea}
        onLimpiar={() => {
          setFiltros(FILTROS_VACIOS);
          setEstado("");
          setCategoria("");
          setArea("");
          setPage(1);
        }}
      >
        <FiltroSelect
          etiqueta="Estado"
          valor={estado}
          opciones={[
            { value: "ABIERTO", label: "Abierto" },
            { value: "EN_TRATAMIENTO", label: "En tratamiento" },
            { value: "CERRADO", label: "Cerrado" },
          ]}
          onChange={(v) => {
            setEstado(v);
            setPage(1);
          }}
        />
        <FiltroSelect
          etiqueta="Categoría"
          valor={categoria}
          opciones={CATEGORIAS_CAUSA_RAIZ.map((c) => ({ value: c, label: etiquetaCategoria(c) }))}
          onChange={(v) => {
            setCategoria(v);
            setPage(1);
          }}
        />
      </BarraFiltros>

      {error && <Alert tono="error">{error}</Alert>}

      <div className="flex justify-end gap-2">
        <input
          ref={inputImport}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={async (e) => {
            const archivo = e.target.files?.[0];
            if (!archivo) return;
            setImportando(true);
            setImportResultado(null);
            setError(null);
            try {
              const form = new FormData();
              form.append("archivo", archivo);
              const body = await apiPostForm<{
                message: string;
                resultados: Array<{ hoja: string; ok: boolean; mensaje: string }>;
              }>("/api/rqr/importar", form);
              setImportResultado(body);
              await cargar();
            } catch (err) {
              setError(err instanceof Error ? err.message : "No pudimos importar el archivo.");
            } finally {
              setImportando(false);
              if (inputImport.current) inputImport.current.value = "";
            }
          }}
        />
        <button
          onClick={() => inputImport.current?.click()}
          disabled={importando}
          className={claseBoton("secundario")}
          title="Sube el Excel de RQR del área (una hoja por formulario)"
        >
          <FileUp className="h-4 w-4" aria-hidden="true" />
          {importando ? "Importando…" : "Importar formularios (Excel)"}
        </button>
        <Link to="/rqr/nuevo" className={claseBoton("primario")}>
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          Nuevo RQR
        </Link>
      </div>

      {importResultado && (
        <Alert tono="exito">
          <p className="font-medium">{importResultado.message}</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {importResultado.resultados.map((r) => (
              <li key={r.hoja} className={r.ok ? "" : "text-amber-700"}>
                • Hoja "{r.hoja}": {r.mensaje}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <Card padding="p-0" className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
              <th className="px-3 py-2">N° RQR</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Modelo</th>
              <th className="px-3 py-2">Sucursal</th>
              <th className="px-3 py-2">Área</th>
              <th className="px-3 py-2">Asesor</th>
              <th className="px-3 py-2">Apertura</th>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2 text-center">Semáforo</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {respuesta === null && cargando && <SkeletonTableRows filas={8} columnas={9} />}
            {(respuesta?.data ?? []).map((r) => {
              const semaforo = r.sentimentAnalysis?.semaforo ?? null;
              // Pulso lento SOLO para ROJO con más de 3 días abierto (no cerrado).
              const pulsar = semaforo === "ROJO" && r.estado !== "CERRADO" && diasDesde(r.fechaApertura) > 3;
              return (
                <tr key={r.id} className="border-b border-gray-100 transition-colors hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <Link to={`/rqr/${r.id}`} className="font-medium text-accent-dark hover:underline">
                      {r.numeroRQR}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink">
                    {r.caso?.nombrePropietario ?? r.nombreClienteManual ?? "(sin datos)"}
                    {!r.caso && (
                      <Badge tono="gris" className="ml-1.5" title="Reclamo sin caso vinculado en el sistema">
                        manual
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{r.caso?.modelo ?? r.modeloManual ?? "—"}</td>
                  <td className="px-3 py-2 text-ink-muted">{r.caso?.sucursal ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge tono={tonoArea(r.area)}>{etiquetaArea(r.area)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{r.asesor}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{fechaCorta(r.fechaApertura)}</td>
                  <td className="px-3 py-2 text-ink-muted">{etiquetaCategoria(r.causaRaiz)}</td>
                  <td className="px-3 py-2 text-center">
                    <PuntoSemaforo
                      semaforo={semaforo}
                      estrellas={r.sentimentAnalysis?.estrellas ?? null}
                      pulsar={pulsar}
                      soloIcono
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Badge tono={BADGE_ESTADO[r.estado] ?? "gris"}>{r.estado.replace("_", " ")}</Badge>
                  </td>
                </tr>
              );
            })}
            {respuesta && respuesta.data.length === 0 && (
              <tr>
                <td colSpan={10}>
                  <EmptyState
                    icono={SearchX}
                    titulo="No encontramos RQR con estos filtros"
                    descripcion="Probá ajustar el estado, la categoría o el rango de fechas."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {respuesta && respuesta.pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            ← Anterior
          </button>
          <span className="text-sm text-ink-muted">
            {page} / {respuesta.pagination.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(respuesta.pagination.totalPages, p + 1))}
            disabled={page >= respuesta.pagination.totalPages}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}
