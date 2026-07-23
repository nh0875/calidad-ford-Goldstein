// Auditoría del sistema (solo ADMIN): quién hizo qué, cuándo y desde qué IP.
// La tabla AuditLog es inmutable; esta pantalla es solo de consulta.
import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ScrollText, SearchX } from "lucide-react";
import { apiGet } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Campo, Input, Select } from "../components/ui/Field";
import { SkeletonTableRows } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";

interface FilaAuditoria {
  id: string;
  accion: string;
  entidad: string;
  entidadId: string | null;
  detalles: unknown;
  ip: string;
  userAgent: string;
  createdAt: string;
  usuario: { id: string; nombre: string; email: string; rol: string } | null;
}

interface Respuesta {
  data: FilaAuditoria[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

interface UsuarioOpcion {
  id: string;
  nombre: string;
  email: string;
}

// Acciones que conviene resaltar en rojo: intentos de acceso fallidos/bloqueados
// y cualquier eliminación.
function esAccionAlerta(accion: string): boolean {
  return /FALLIDO|BLOQUEADO|ELIMINAD/.test(accion);
}

function fechaHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const FILTROS_VACIOS = { usuarioId: "", accion: "", entidad: "", ip: "", fechaDesde: "", fechaHasta: "" };

export default function Auditoria() {
  const [filtros, setFiltros] = useState({ ...FILTROS_VACIOS });
  const [page, setPage] = useState(1);
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandida, setExpandida] = useState<string | null>(null);

  const [usuarios, setUsuarios] = useState<UsuarioOpcion[]>([]);
  const [acciones, setAcciones] = useState<string[]>([]);
  const [entidades, setEntidades] = useState<string[]>([]);

  // Opciones de filtros (usuarios + acciones/entidades ya registradas)
  useEffect(() => {
    apiGet<{ data: UsuarioOpcion[] }>("/api/usuarios")
      .then((r) => setUsuarios(r.data))
      .catch(() => {});
    apiGet<{ acciones: string[]; entidades: string[] }>("/api/auditoria/opciones")
      .then((r) => {
        setAcciones(r.acciones);
        setEntidades(r.entidades);
      })
      .catch(() => {});
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "30" });
      if (filtros.usuarioId) params.set("usuarioId", filtros.usuarioId);
      if (filtros.accion) params.set("accion", filtros.accion);
      if (filtros.entidad) params.set("entidad", filtros.entidad);
      if (filtros.ip.trim()) params.set("ip", filtros.ip.trim());
      if (filtros.fechaDesde) params.set("fechaDesde", filtros.fechaDesde);
      if (filtros.fechaHasta) params.set("fechaHasta", filtros.fechaHasta);
      setRespuesta(await apiGet<Respuesta>(`/api/auditoria?${params}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar la auditoría. Probá recargar la página.");
    } finally {
      setCargando(false);
    }
  }, [filtros, page]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function cambiar<K extends keyof typeof FILTROS_VACIOS>(campo: K, valor: string) {
    setFiltros((prev) => ({ ...prev, [campo]: valor }));
    setPage(1);
  }

  const filas = respuesta?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Campo etiqueta="Usuario">
          <Select value={filtros.usuarioId} onChange={(e) => cambiar("usuarioId", e.target.value)}>
            <option value="">Todos</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo etiqueta="Acción">
          <Select value={filtros.accion} onChange={(e) => cambiar("accion", e.target.value)}>
            <option value="">Todas</option>
            {acciones.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo etiqueta="Entidad">
          <Select value={filtros.entidad} onChange={(e) => cambiar("entidad", e.target.value)}>
            <option value="">Todas</option>
            {entidades.map((en) => (
              <option key={en} value={en}>
                {en}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo etiqueta="IP (búsqueda libre)">
          <Input type="text" value={filtros.ip} placeholder="Ej: 190.1" onChange={(e) => cambiar("ip", e.target.value)} />
        </Campo>
        <Campo etiqueta="Desde">
          <Input type="date" value={filtros.fechaDesde} onChange={(e) => cambiar("fechaDesde", e.target.value)} />
        </Campo>
        <Campo etiqueta="Hasta">
          <Input type="date" value={filtros.fechaHasta} onChange={(e) => cambiar("fechaHasta", e.target.value)} />
        </Campo>
      </Card>

      {error && <Alert tono="error">{error}</Alert>}

      <Card padding="p-0" className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
              <th className="px-3 py-2 w-8"></th>
              <th className="px-3 py-2">Fecha / hora</th>
              <th className="px-3 py-2">Usuario</th>
              <th className="px-3 py-2">Acción</th>
              <th className="px-3 py-2">Entidad</th>
              <th className="px-3 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {respuesta === null && cargando && <SkeletonTableRows filas={10} columnas={6} />}
            {filas.map((f) => {
              const abierta = expandida === f.id;
              const tieneDetalle = f.detalles !== null && f.detalles !== undefined;
              return (
                <Fragment key={f.id}>
                  <tr
                    className="cursor-pointer border-b border-gray-100 transition-colors hover:bg-gray-50"
                    onClick={() => setExpandida(abierta ? null : f.id)}
                  >
                    <td className="px-3 py-2 text-ink-muted">
                      {tieneDetalle ? (
                        abierta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{fechaHora(f.createdAt)}</td>
                    <td className="px-3 py-2 text-ink">
                      {f.usuario ? (
                        <span title={f.usuario.email}>{f.usuario.nombre}</span>
                      ) : (
                        <Badge tono="gris">Sistema</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tono={esAccionAlerta(f.accion) ? "rojo" : "azul"}>{f.accion}</Badge>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      {f.entidad}
                      {f.entidadId && <span className="ml-1 text-xs text-gray-400">#{f.entidadId.slice(0, 8)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink-muted">{f.ip}</td>
                  </tr>
                  {abierta && tieneDetalle && (
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="text-xs text-ink-muted">
                          <div className="mb-1">
                            <span className="font-semibold uppercase">User-Agent:</span> {f.userAgent}
                          </div>
                          <span className="font-semibold uppercase">Detalles:</span>
                          <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-white p-3 text-[11px] leading-relaxed text-ink ring-1 ring-gray-200">
                            {JSON.stringify(f.detalles, null, 2)}
                          </pre>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {respuesta && filas.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    icono={filas.length === 0 && !cargando ? SearchX : ScrollText}
                    titulo="No hay registros con estos filtros"
                    descripcion="Probá ajustar el usuario, la acción o el rango de fechas."
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
            {page} / {respuesta.pagination.totalPages} · {respuesta.pagination.total} registro(s)
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
