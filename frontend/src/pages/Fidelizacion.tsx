// Fidelización (Parte C): se sube el Excel de agendamientos (mismo formato Ford),
// el sistema lee "Comentario del Asesor" y detecta los clientes con un service de
// mantenimiento 1° a 5° PENDIENTE. A esos se les manda UN recordatorio por
// WhatsApp (plantilla "fidelizacion_posventa"). NO se clasifica la respuesta.
import { useEffect, useRef, useState } from "react";
import { FileUp, Gift, Send, Trash2, Users } from "lucide-react";
import { apiDelete, apiGet, apiPostForm, apiPostJson } from "../lib/api";
import { getUsuario } from "../lib/auth";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";

interface ResumenCarga {
  totalFilas: number;
  conServicio1a5: number;
  servicioFueraDeRango: number;
  sinServicio: number;
  sinTelefono: number;
}
interface RespuestaSubida {
  message: string;
  uploadId: string;
  resumen: ResumenCarga;
  pendientes: number;
}
interface CargaFidel {
  id: string;
  filename: string;
  sucursal: string;
  periodo: string;
  uploadedBy: string;
  uploadedAt: string;
  totalRows: number;
  pendientes: number;
  enviados: number;
  errores: number;
  omitidos: number;
}
interface ClienteFidel {
  id: string;
  nombre: string;
  telefono: string;
  modelo: string | null;
  patente: string | null;
  asesor: string | null;
  numeroServicio: number;
  estado: "PENDIENTE" | "ENVIADO" | "ERROR" | "OMITIDO";
  error: string | null;
  enviadoEn: string | null;
  comentarioAsesor: string;
}
interface DetalleCarga {
  upload: { id: string; filename: string; sucursal: string; periodo: string; uploadedAt: string; totalRows: number };
  clientes: ClienteFidel[];
}
interface Progreso {
  enCola: number;
  enviando: number;
  completados: number;
  fallidos: number;
}

const TONO_ESTADO: Record<ClienteFidel["estado"], "azul" | "verde" | "rojo" | "gris"> = {
  PENDIENTE: "azul",
  ENVIADO: "verde",
  ERROR: "rojo",
  OMITIDO: "gris",
};
const LABEL_ESTADO: Record<ClienteFidel["estado"], string> = {
  PENDIENTE: "Pendiente",
  ENVIADO: "Enviado",
  ERROR: "Error",
  OMITIDO: "Omitido",
};

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export default function Fidelizacion() {
  const esAdmin = getUsuario()?.rol === "ADMIN";
  const [cargas, setCargas] = useState<CargaFidel[]>([]);
  const [cargando, setCargando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);
  const [sucursal, setSucursal] = useState("General");

  const [detalle, setDetalle] = useState<DetalleCarga | null>(null);
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function cargarLista() {
    setCargando(true);
    try {
      const { data } = await apiGet<{ data: CargaFidel[] }>("/api/fidelizacion");
      setCargas(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar el historial.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargarLista();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function subir(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    const archivo = inputArchivo.current?.files?.[0];
    if (!archivo) return setError("Elegí el Excel de agendamientos (.xls o .xlsx).");
    setSubiendo(true);
    try {
      const form = new FormData();
      form.append("archivo", archivo);
      form.append("sucursal", sucursal.trim() || "General");
      const data = await apiPostForm<RespuestaSubida>("/api/fidelizacion", form);
      setMensaje(data.message);
      if (inputArchivo.current) inputArchivo.current.value = "";
      await cargarLista();
      await verDetalle(data.uploadId); // abrir directo la carga recién subida
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos procesar el archivo.");
    } finally {
      setSubiendo(false);
    }
  }

  async function verDetalle(id: string) {
    setError(null);
    try {
      const data = await apiGet<DetalleCarga>(`/api/fidelizacion/${id}`);
      setDetalle(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos abrir la carga.");
    }
  }

  function iniciarPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const p = await apiGet<Progreso>("/api/fidelizacion/progreso");
        setProgreso(p);
        if (p.enCola === 0 && p.enviando === 0) {
          if (pollRef.current) clearInterval(pollRef.current);
          setProgreso(null);
          await verDetalle(id);
          await cargarLista();
        }
      } catch {
        // reintenta en el próximo tick
      }
    }, 2500);
  }

  async function enviar(id: string) {
    setError(null);
    setMensaje(null);
    try {
      const r = await apiPostJson<{ message: string; encolados: number }>(`/api/fidelizacion/${id}/enviar`, {});
      setMensaje(r.message);
      if (r.encolados > 0) iniciarPolling(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos iniciar el envío.");
    }
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar esta carga de fidelización? (recuperable por un administrador)")) return;
    try {
      await apiDelete(`/api/fidelizacion/${id}`);
      if (detalle?.upload.id === id) setDetalle(null);
      await cargarLista();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos eliminar la carga.");
    }
  }

  return (
    <div className="space-y-4">
      <Alert tono="info">
        <span className="font-medium">Recordatorio de service pendiente.</span> El sistema lee la columna{" "}
        <span className="font-medium">"Comentario del Asesor"</span> y detecta los clientes con el{" "}
        <span className="font-medium">1° a 5° service de mantenimiento</span> pendiente para mandarles un recordatorio
        por WhatsApp. No clasifica la respuesta: es solo un aviso. La plantilla{" "}
        <span className="font-mono text-xs">fidelizacion_posventa</span> está pendiente de aprobación en Meta: podés
        cargar y detectar ahora; los mensajes recién saldrán cuando Meta la apruebe.
      </Alert>

      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}

      {/* Carga del Excel */}
      <Card padding="p-6" className="max-w-2xl">
        <form onSubmit={subir} className="space-y-4">
          <p className="text-sm text-ink-muted">
            Subí el Excel de agendamientos (el mismo formato que Contacto Posventa, .xls o .xlsx). El sistema detecta
            solo a los clientes con service 1° a 5° pendiente.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-muted">Archivo Excel</span>
              <input
                ref={inputArchivo}
                type="file"
                accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-navy file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-navy-dark"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-muted">Sucursal (opcional)</span>
              <input
                value={sucursal}
                onChange={(e) => setSucursal(e.target.value)}
                placeholder="General"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
          </div>
          <button type="submit" disabled={subiendo} className={claseBoton("primario")}>
            <FileUp className="h-4 w-4" aria-hidden="true" />
            {subiendo ? "Detectando…" : "Cargar y detectar clientes"}
          </button>
        </form>
      </Card>

      {/* Progreso de envío */}
      {progreso && (
        <Alert tono="info">
          Enviando recordatorios… {progreso.enviando} en curso, {progreso.enCola} en cola, {progreso.completados}{" "}
          completados{progreso.fallidos > 0 ? `, ${progreso.fallidos} con error` : ""}.
        </Alert>
      )}

      {/* Historial de cargas */}
      <Card padding="p-0">
        <div className="border-b px-4 py-3 text-sm font-semibold text-ink">Cargas de fidelización</div>
        {cargas.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icono={Gift}
              titulo="Todavía no hay cargas"
              descripcion="Subí el primer Excel de agendamientos para detectar los services pendientes."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
                  <th className="px-4 py-2">Archivo</th>
                  <th className="px-4 py-2">Sucursal</th>
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2 text-center">Pendientes</th>
                  <th className="px-4 py-2 text-center">Enviados</th>
                  <th className="px-4 py-2 text-center">Errores</th>
                  <th className="px-4 py-2 text-center">Omitidos</th>
                  <th className="px-4 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cargas.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-canvas">
                    <td className="px-4 py-2 text-ink" title={c.filename}>
                      {c.filename.length > 34 ? c.filename.slice(0, 34) + "…" : c.filename}
                    </td>
                    <td className="px-4 py-2 text-ink-muted">{c.sucursal}</td>
                    <td className="px-4 py-2 text-ink-muted">{fechaCorta(c.uploadedAt)}</td>
                    <td className="px-4 py-2 text-center">
                      <Badge tono="azul">{c.pendientes}</Badge>
                    </td>
                    <td className="px-4 py-2 text-center text-green-700">{c.enviados}</td>
                    <td className="px-4 py-2 text-center text-red-700">{c.errores}</td>
                    <td className="px-4 py-2 text-center text-ink-muted">{c.omitidos}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => verDetalle(c.id)} className="text-xs font-medium text-accent-dark hover:underline">
                          <Users className="mr-1 inline h-3.5 w-3.5" />Ver
                        </button>
                        {c.pendientes > 0 && (
                          <button
                            onClick={() => enviar(c.id)}
                            className={claseBoton("primario", "!py-1 !px-2 !text-xs")}
                            title={`Enviar recordatorio a ${c.pendientes} cliente(s)`}
                          >
                            <Send className="h-3.5 w-3.5" /> Enviar ({c.pendientes})
                          </button>
                        )}
                        {esAdmin && (
                          <button onClick={() => eliminar(c.id)} className="text-ink-muted hover:text-red-600" title="Eliminar carga">
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

      {/* Detalle de la carga seleccionada */}
      {detalle && <DetalleClientes detalle={detalle} onEnviar={() => enviar(detalle.upload.id)} onCerrar={() => setDetalle(null)} />}
    </div>
  );
}

function DetalleClientes({
  detalle,
  onEnviar,
  onCerrar,
}: {
  detalle: DetalleCarga;
  onEnviar: () => void;
  onCerrar: () => void;
}) {
  const { upload, clientes } = detalle;
  const pendientes = clientes.filter((c) => c.estado === "PENDIENTE").length;
  const porServicio = clientes.reduce<Record<number, number>>((acc, c) => {
    acc[c.numeroServicio] = (acc[c.numeroServicio] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Card padding="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="text-sm">
          <span className="font-semibold text-ink">{upload.filename}</span>{" "}
          <span className="text-ink-muted">· {clientes.length} cliente(s) detectados · {upload.sucursal}</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5].map((n) =>
              porServicio[n] ? (
                <Badge key={n} tono="morado">{n}° service: {porServicio[n]}</Badge>
              ) : null
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pendientes > 0 && (
            <button onClick={onEnviar} className={claseBoton("primario", "!py-1.5")}>
              <Send className="h-4 w-4" /> Enviar recordatorios ({pendientes})
            </button>
          )}
          <button onClick={onCerrar} className={claseBoton("fantasma", "border border-gray-300 !py-1.5")}>Cerrar</button>
        </div>
      </div>
      <div className="max-h-[28rem] overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-4 py-2 text-center">Service</th>
              <th className="px-4 py-2">Cliente</th>
              <th className="px-4 py-2">Teléfono</th>
              <th className="px-4 py-2">Modelo</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id} className="border-b border-gray-100">
                <td className="px-4 py-2 text-center font-semibold text-ink">{c.numeroServicio}°</td>
                <td className="px-4 py-2 text-ink">{c.nombre}</td>
                <td className="px-4 py-2 text-ink-muted">{c.telefono || "—"}</td>
                <td className="px-4 py-2 text-ink-muted">{c.modelo || "—"}</td>
                <td className="px-4 py-2">
                  <Badge tono={TONO_ESTADO[c.estado]}>{LABEL_ESTADO[c.estado]}</Badge>
                </td>
                <td className="px-4 py-2 text-xs text-ink-muted" title={c.comentarioAsesor}>
                  {c.error ? <span className="text-red-700">{c.error}</span> : c.enviadoEn ? fechaCorta(c.enviadoEn) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
