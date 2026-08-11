// Clientes de fidelización: el listado global de TODOS los destinatarios, de
// todas las cargas. Es a Fidelización lo que /casos es a la Carga de Excel.
//
// Acá se busca, se filtra, se corrige un dato mal cargado, se da de alta el
// cliente que no vino en ninguna planilla, se excluye a alguien del envío (sin
// borrarlo) y se le manda el recordatorio a uno puntual.
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Ban, Pencil, RotateCcw, Search, Send, Trash2, UserPlus, X } from "lucide-react";
import { apiDelete, apiGet, apiPatchJson, apiPostJson } from "../lib/api";
import { getUsuario } from "../lib/auth";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ConfirmarEliminacion } from "../components/ui/ConfirmarEliminacion";
import { EmptyState } from "../components/ui/EmptyState";
import { Campo, Input, Select, Textarea } from "../components/ui/Field";

type Origen = "TURNOS" | "VENTAS" | "MANUAL";
type Estado = "PENDIENTE" | "ENVIADO" | "ERROR" | "OMITIDO";

const LABEL_ORIGEN: Record<Origen, string> = {
  TURNOS: "Turnos de taller",
  VENTAS: "Ventas 0km",
  MANUAL: "Carga manual",
};
const TONO_ORIGEN: Record<Origen, "azul" | "morado" | "gris"> = {
  TURNOS: "azul",
  VENTAS: "morado",
  MANUAL: "gris",
};
const LABEL_ESTADO: Record<Estado, string> = {
  PENDIENTE: "Pendiente",
  ENVIADO: "Enviado",
  ERROR: "Error",
  OMITIDO: "Excluido",
};
const TONO_ESTADO: Record<Estado, "azul" | "verde" | "rojo" | "gris"> = {
  PENDIENTE: "azul",
  ENVIADO: "verde",
  ERROR: "rojo",
  OMITIDO: "gris",
};

interface Cliente {
  id: string;
  origen: Origen;
  nombre: string;
  telefono: string;
  modelo: string | null;
  patente: string | null;
  asesor: string | null;
  numeroServicio: number | null;
  comentarioAsesor: string | null;
  fechaEntrega: string | null;
  sucursal: string | null;
  estado: Estado;
  error: string | null;
  enviadoEn: string | null;
  quiereAsesor: boolean;
  contactable: boolean;
  mensajes: number;
  carga: { id: string; filename: string; periodo: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface Respuesta {
  data: Cliente[];
  total: number;
  pagina: number;
  porPagina: number;
  opciones: {
    provincias: string[];
    cargas: Array<{ id: string; filename: string; periodo: string }>;
  };
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Fecha para un <input type="date"> (AAAA-MM-DD) a partir de un ISO. */
function fechaInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

export default function ClientesFidelizacion() {
  const esAdmin = getUsuario()?.rol === "ADMIN";

  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [filtros, setFiltros] = useState({ q: "", origen: "", estado: "", uploadId: "", sucursal: "" });
  const [pagina, setPagina] = useState(1);
  const porPagina = 50;

  // Buscador con debounce: el input responde al instante y la API se llama
  // 350 ms después de dejar de tipear (no una vez por tecla).
  const [busquedaInput, setBusquedaInput] = useState("");
  useEffect(() => {
    const v = busquedaInput.trim();
    if (v === filtros.q) return;
    const t = setTimeout(() => {
      setFiltros((prev) => ({ ...prev, q: v }));
      setPagina(1);
    }, 350);
    return () => clearTimeout(t);
  }, [busquedaInput, filtros.q]);

  const [modal, setModal] = useState<{ cliente: Cliente | null } | null>(null);
  const [aEliminar, setAEliminar] = useState<Cliente | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null); // id en curso

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pagina: String(pagina), porPagina: String(porPagina) });
      if (filtros.q) params.set("q", filtros.q);
      if (filtros.origen) params.set("origen", filtros.origen);
      if (filtros.estado) params.set("estado", filtros.estado);
      if (filtros.uploadId) params.set("uploadId", filtros.uploadId);
      if (filtros.sucursal) params.set("sucursal", filtros.sucursal);
      setRespuesta(await apiGet<Respuesta>(`/api/fidelizacion/clientes?${params}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la lista.");
    } finally {
      setCargando(false);
    }
  }, [filtros, pagina]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Toda acción sobre una fila comparte el mismo manejo: bloquea esa fila,
  // muestra el mensaje del backend y recarga.
  async function accion(cliente: Cliente, fn: () => Promise<{ message: string }>) {
    setOcupado(cliente.id);
    setError(null);
    setMensaje(null);
    try {
      const r = await fn();
      setMensaje(r.message);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.");
    } finally {
      setOcupado(null);
    }
  }

  const totalPaginas = respuesta ? Math.max(1, Math.ceil(respuesta.total / respuesta.porPagina)) : 1;
  const hayFiltros = Boolean(
    filtros.q || filtros.origen || filtros.estado || filtros.uploadId || filtros.sucursal
  );

  function limpiarFiltros() {
    setBusquedaInput("");
    setFiltros({ q: "", origen: "", estado: "", uploadId: "", sucursal: "" });
    setPagina(1);
  }

  return (
    <div className="space-y-4">
      <Alert tono="info">
        Todos los destinatarios de fidelización, vengan de la planilla de turnos, de la de ventas o cargados a mano.
        Desde acá se corrigen datos, se agrega un cliente suelto, se excluye a alguien del envío o se le manda el
        recordatorio a uno solo.
      </Alert>

      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}

      {/* Buscador + filtros */}
      <Card padding="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[16rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <input
                value={busquedaInput}
                onChange={(e) => setBusquedaInput(e.target.value)}
                placeholder="Buscar por nombre, teléfono, patente o modelo…"
                className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-8 text-sm text-ink focus:border-accent focus:outline-none"
              />
              {busquedaInput && (
                <button
                  onClick={() => setBusquedaInput("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                  title="Limpiar búsqueda"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <button onClick={() => setModal({ cliente: null })} className={claseBoton("primario", "!py-1.5")}>
              <UserPlus className="h-4 w-4" /> Nuevo cliente
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Select
              value={filtros.origen}
              onChange={(e) => {
                setFiltros((f) => ({ ...f, origen: e.target.value }));
                setPagina(1);
              }}
              className="!w-auto !py-1 !text-xs"
            >
              <option value="">Toda planilla</option>
              <option value="TURNOS">Turnos de taller</option>
              <option value="VENTAS">Ventas 0km</option>
              <option value="MANUAL">Carga manual</option>
            </Select>
            <Select
              value={filtros.estado}
              onChange={(e) => {
                setFiltros((f) => ({ ...f, estado: e.target.value }));
                setPagina(1);
              }}
              className="!w-auto !py-1 !text-xs"
            >
              <option value="">Todo estado</option>
              <option value="PENDIENTE">Pendiente</option>
              <option value="ENVIADO">Enviado</option>
              <option value="ERROR">Error</option>
              <option value="OMITIDO">Excluido</option>
            </Select>
            {(respuesta?.opciones.provincias.length ?? 0) > 1 && (
              <Select
                value={filtros.sucursal}
                onChange={(e) => {
                  setFiltros((f) => ({ ...f, sucursal: e.target.value }));
                  setPagina(1);
                }}
                className="!w-auto !py-1 !text-xs"
              >
                <option value="">Toda provincia</option>
                {respuesta?.opciones.provincias.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            )}
            {(respuesta?.opciones.cargas.length ?? 0) > 1 && (
              <Select
                value={filtros.uploadId}
                onChange={(e) => {
                  setFiltros((f) => ({ ...f, uploadId: e.target.value }));
                  setPagina(1);
                }}
                className="!w-auto !py-1 !text-xs"
              >
                <option value="">Toda carga</option>
                {respuesta?.opciones.cargas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.filename} ({c.periodo})
                  </option>
                ))}
              </Select>
            )}
            {hayFiltros && (
              <button onClick={limpiarFiltros} className="text-xs font-medium text-accent-dark hover:underline">
                Limpiar filtros
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Listado */}
      <Card padding="p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold text-ink">
            {respuesta ? `${respuesta.total} cliente(s)` : "Clientes"}
          </span>
          {cargando && <span className="text-xs text-ink-muted">Cargando…</span>}
        </div>

        {respuesta && respuesta.data.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icono={UserPlus}
              titulo={hayFiltros ? "No hay clientes con esos filtros" : "Todavía no hay clientes"}
              descripcion={
                hayFiltros
                  ? "Probá limpiando los filtros o buscando otra cosa."
                  : "Subí una planilla desde Fidelización o agregá un cliente a mano."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
                  <th className="px-4 py-2">Cliente</th>
                  <th className="px-4 py-2">Teléfono</th>
                  <th className="px-4 py-2">Planilla</th>
                  <th className="px-4 py-2">Service / entrega</th>
                  <th className="px-4 py-2">Provincia</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {respuesta?.data.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-canvas">
                    <td className="px-4 py-2">
                      <div className="font-medium text-ink">{c.nombre}</div>
                      <div className="text-xs text-ink-muted">
                        {[c.modelo, c.patente].filter(Boolean).join(" · ") || "—"}
                      </div>
                      {c.quiereAsesor && (
                        <Badge tono="amarillo" className="mt-1">
                          Pidió turno con asesor
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-ink-muted">
                      {c.telefono || "—"}
                      {!c.contactable && (
                        <Badge tono="rojo" className="ml-1" title="No se puede entregar el mensaje">
                          sin teléfono válido
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tono={TONO_ORIGEN[c.origen]} className="cursor-default">
                        {LABEL_ORIGEN[c.origen]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-ink-muted">
                      {c.numeroServicio !== null
                        ? `${c.numeroServicio}° service`
                        : c.fechaEntrega
                          ? `Entrega ${fechaCorta(c.fechaEntrega)}`
                          : "—"}
                    </td>
                    <td className="px-4 py-2 text-ink-muted">{c.sucursal || "—"}</td>
                    <td className="px-4 py-2">
                      <Badge tono={TONO_ESTADO[c.estado]}>{LABEL_ESTADO[c.estado]}</Badge>
                      {c.estado === "ENVIADO" && (
                        <div className="mt-0.5 text-xs text-ink-muted">{fechaCorta(c.enviadoEn)}</div>
                      )}
                      {c.error && c.estado !== "ENVIADO" && (
                        <div className="mt-0.5 max-w-[16rem] text-xs text-ink-muted" title={c.error}>
                          {c.error.length > 60 ? c.error.slice(0, 60) + "…" : c.error}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setModal({ cliente: c })}
                          disabled={ocupado === c.id}
                          className="text-ink-muted hover:text-accent-dark disabled:opacity-40"
                          title="Editar datos"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>

                        {/* Enviarle solo a él: únicamente si todavía puede recibirlo */}
                        {(c.estado === "PENDIENTE" || c.estado === "ERROR") && c.contactable && (
                          <button
                            onClick={() =>
                              accion(c, () =>
                                apiPostJson<{ message: string }>(`/api/fidelizacion/clientes/${c.id}/enviar`, {})
                              )
                            }
                            disabled={ocupado === c.id}
                            className="text-ink-muted hover:text-green-700 disabled:opacity-40"
                            title="Enviarle el recordatorio a este cliente"
                          >
                            <Send className="h-4 w-4" />
                          </button>
                        )}

                        {/* Excluir / reincorporar (al que ya se le envió, ninguna) */}
                        {c.estado === "OMITIDO" ? (
                          <button
                            onClick={() =>
                              accion(c, () =>
                                apiPostJson<{ message: string }>(`/api/fidelizacion/clientes/${c.id}/excluir`, {
                                  excluir: false,
                                })
                              )
                            }
                            disabled={ocupado === c.id}
                            className="text-ink-muted hover:text-accent-dark disabled:opacity-40"
                            title="Reincorporar al envío"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        ) : c.estado !== "ENVIADO" ? (
                          <button
                            onClick={() =>
                              accion(c, () =>
                                apiPostJson<{ message: string }>(`/api/fidelizacion/clientes/${c.id}/excluir`, {
                                  excluir: true,
                                })
                              )
                            }
                            disabled={ocupado === c.id}
                            className="text-ink-muted hover:text-yellow-700 disabled:opacity-40"
                            title="Excluir del envío (no lo borra)"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        ) : null}

                        {esAdmin && (
                          <button
                            onClick={() => setAEliminar(c)}
                            disabled={ocupado === c.id}
                            className="text-ink-muted hover:text-red-600 disabled:opacity-40"
                            title="Eliminar de la lista"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totalPaginas > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={pagina <= 1}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            ← Anterior
          </button>
          <span className="text-sm text-ink-muted">
            {pagina} / {totalPaginas}
          </span>
          <button
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            disabled={pagina >= totalPaginas}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-gray-50 disabled:opacity-40"
          >
            Siguiente →
          </button>
        </div>
      )}

      {modal && (
        <ClienteModal
          cliente={modal.cliente}
          provincias={respuesta?.opciones.provincias ?? []}
          onCancelar={() => setModal(null)}
          onGuardado={(msg) => {
            setModal(null);
            setMensaje(msg);
            void cargar();
          }}
        />
      )}

      {aEliminar && (
        <ConfirmarEliminacion
          titulo={`Eliminar a ${aEliminar.nombre}`}
          descripcion="Se quita de la lista de fidelización. No se borra de verdad: queda recuperable, pero deja de aparecer y no recibe el recordatorio."
          palabra="ELIMINAR"
          cargando={ocupado === aEliminar.id}
          onCancelar={() => setAEliminar(null)}
          onConfirmar={() => {
            const c = aEliminar;
            setAEliminar(null);
            void accion(c, () => apiDelete<{ message: string }>(`/api/fidelizacion/clientes/${c.id}`));
          }}
        />
      )}
    </div>
  );
}

// ---------- Modal de alta / edición ----------

function ClienteModal({
  cliente,
  provincias,
  onCancelar,
  onGuardado,
}: {
  cliente: Cliente | null;
  provincias: string[];
  onCancelar: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  const esEdicion = !!cliente;
  const [form, setForm] = useState({
    nombre: cliente?.nombre ?? "",
    telefono: cliente?.telefono ?? "",
    modelo: cliente?.modelo ?? "",
    patente: cliente?.patente ?? "",
    asesor: cliente?.asesor ?? "",
    numeroServicio: cliente?.numeroServicio ? String(cliente.numeroServicio) : "",
    fechaEntrega: fechaInput(cliente?.fechaEntrega ?? null),
    sucursal: cliente?.sucursal ?? "",
    comentarioAsesor: cliente?.comentarioAsesor ?? "",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (campo: keyof typeof form, valor: string) => setForm((f) => ({ ...f, [campo]: valor }));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const cuerpo = {
        ...form,
        // El backend espera un número o null, no "".
        numeroServicio: form.numeroServicio ? Number(form.numeroServicio) : null,
      };
      const r = esEdicion
        ? await apiPatchJson<{ message: string }>(`/api/fidelizacion/clientes/${cliente!.id}`, cuerpo)
        : await apiPostJson<{ message: string }>("/api/fidelizacion/clientes", cuerpo);
      onGuardado(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy/50 p-4">
      <form
        onSubmit={guardar}
        className="my-8 w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl motion-safe:animate-fade-slide-in"
      >
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          {esEdicion ? (
            <>
              <Pencil className="h-5 w-5 text-accent" aria-hidden="true" /> Editar cliente
            </>
          ) : (
            <>
              <UserPlus className="h-5 w-5 text-accent" aria-hidden="true" /> Nuevo cliente de fidelización
            </>
          )}
        </h3>
        <p className="mt-1 text-sm text-ink-muted">
          {esEdicion
            ? "Corregí los datos mal cargados. Editar no reenvía el recordatorio."
            : "Para el cliente que no vino en ninguna planilla. Queda pendiente de recordatorio."}
        </p>

        {error && (
          <div className="mt-3">
            <Alert tono="error">{error}</Alert>
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre del cliente">
            <Input value={form.nombre} onChange={(e) => set("nombre", e.target.value)} required maxLength={160} />
          </Campo>
          <Campo etiqueta="Teléfono" hint="Celular con código de área (ej. 261 5600368)">
            <Input value={form.telefono} onChange={(e) => set("telefono", e.target.value)} required />
          </Campo>
          <Campo etiqueta="Modelo">
            <Input value={form.modelo} onChange={(e) => set("modelo", e.target.value)} maxLength={120} />
          </Campo>
          <Campo etiqueta="Patente">
            <Input value={form.patente} onChange={(e) => set("patente", e.target.value)} maxLength={20} />
          </Campo>
          <Campo etiqueta="Asesor / vendedor">
            <Input value={form.asesor} onChange={(e) => set("asesor", e.target.value)} maxLength={120} />
          </Campo>
          <Campo etiqueta="Provincia">
            <Input
              value={form.sucursal}
              onChange={(e) => set("sucursal", e.target.value)}
              list="provincias-fidelizacion"
              maxLength={80}
            />
            <datalist id="provincias-fidelizacion">
              {provincias.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Campo>
          <Campo etiqueta="Service pendiente" hint="Solo si corresponde (1 a 5). Vacío = sin service asignado.">
            <Select value={form.numeroServicio} onChange={(e) => set("numeroServicio", e.target.value)}>
              <option value="">Sin service</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}° service
                </option>
              ))}
            </Select>
          </Campo>
          <Campo etiqueta="Fecha de entrega del vehículo" hint="Opcional, para los clientes que compraron un 0km.">
            <Input type="date" value={form.fechaEntrega} onChange={(e) => set("fechaEntrega", e.target.value)} />
          </Campo>
        </div>

        <div className="mt-3">
          <Campo etiqueta="Comentario">
            <Textarea
              value={form.comentarioAsesor}
              onChange={(e) => set("comentarioAsesor", e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </Campo>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            className={claseBoton("fantasma", "border border-gray-300")}
            disabled={guardando}
          >
            Cancelar
          </button>
          <button type="submit" className={claseBoton("primario")} disabled={guardando}>
            {guardando ? "Guardando…" : esEdicion ? "Guardar cambios" : "Agregar cliente"}
          </button>
        </div>
      </form>
    </div>
  );
}
