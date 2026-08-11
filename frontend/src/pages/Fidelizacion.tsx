// Fidelización (Parte C): se sube un Excel y a los clientes que salen de ahí se
// les manda UN recordatorio por WhatsApp (plantilla "fidelizacion_posventa").
// NO se clasifica la respuesta. Entran dos planillas y el sistema reconoce sola
// cuál es:
//  - Turnos de Ford: lee "Comentario del Asesor"/"Servicio" y toma solo a los
//    que tienen pendiente el service 1° a 5° (6° o más queda afuera).
//  - Ventas de la agencia: no trae dato de service, así que toma a todos los
//    Ford 0km de la planilla.
import { useEffect, useRef, useState } from "react";
import { FileUp, Gift, Send, Trash2, Users } from "lucide-react";
import { apiDelete, apiGet, apiPostForm, apiPostJson } from "../lib/api";
import { getUsuario } from "../lib/auth";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";

// De qué planilla salió la carga (lo detecta el backend por las columnas).
type Origen = "TURNOS" | "VENTAS";

const LABEL_ORIGEN: Record<Origen, string> = {
  TURNOS: "Turnos de taller",
  VENTAS: "Ventas 0km",
};

interface ResumenCarga {
  formato: Origen;
  totalFilas: number;
  candidatos: number;
  destinatarios: number;
  sinTelefono: number;
  conServicio1a5: number;
  servicioFueraDeRango: number;
  sinServicio: number;
  noElegibles: number;
  duplicados: number;
}
interface RespuestaSubida {
  message: string;
  uploadId: string;
  formato: Origen;
  resumen: ResumenCarga;
  pendientes: number;
}
interface CargaFidel {
  id: string;
  filename: string;
  origen: Origen;
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
  origen: Origen;
  nombre: string;
  telefono: string;
  modelo: string | null;
  patente: string | null;
  asesor: string | null;
  numeroServicio: number | null; // null en las cargas de Ventas (no traen service)
  fechaEntrega: string | null; // solo Ventas
  sucursal: string | null;
  estado: "PENDIENTE" | "ENVIADO" | "ERROR" | "OMITIDO";
  error: string | null;
  enviadoEn: string | null;
  comentarioAsesor: string | null;
}
interface DetalleCarga {
  upload: {
    id: string;
    filename: string;
    origen: Origen;
    sucursal: string;
    periodo: string;
    uploadedAt: string;
    totalRows: number;
  };
  clientes: ClienteFidel[];
}
interface Progreso {
  enCola: number;
  enviando: number;
  completados: number;
  fallidos: number;
}
interface EstadoPlantilla {
  templateName: string;
  estado: string; // "APPROVED" | "PENDING" | "REJECTED" | ... | "" (sin confirmar)
  aprobada: boolean;
  puedeEnviar: boolean;
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
  const [plantilla, setPlantilla] = useState<EstadoPlantilla | null>(null);
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
    apiGet<EstadoPlantilla>("/api/fidelizacion/plantilla").then(setPlantilla).catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function subir(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    const archivo = inputArchivo.current?.files?.[0];
    if (!archivo) return setError("Elegí el Excel (.xls o .xlsx): turnos de taller o planilla de ventas.");
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
        <span className="font-medium">Recordatorio para que el cliente vuelva al taller.</span> Se sube el Excel y el
        sistema reconoce solo de cuál de las dos planillas se trata:{" "}
        <span className="font-medium">turnos de taller</span> (lee "Comentario del Asesor" / "Servicio" y toma únicamente
        a los que tienen pendiente el <span className="font-medium">1° a 5° service</span>) o{" "}
        <span className="font-medium">ventas</span> (no trae dato de service, así que toma a todos los{" "}
        <span className="font-medium">Ford 0km</span> de la planilla). No clasifica la respuesta: es solo un aviso.
      </Alert>

      {/* Estado de la plantilla en Meta: el sistema se entera solo por el webhook */}
      {plantilla &&
        (plantilla.aprobada ? (
          <Alert tono="exito">
            Plantilla <span className="font-mono text-xs">{plantilla.templateName}</span> <strong>aprobada por Meta</strong>{" "}
            ✓ — ya se pueden enviar los recordatorios.
          </Alert>
        ) : plantilla.estado ? (
          <Alert tono="advertencia">
            La plantilla <span className="font-mono text-xs">{plantilla.templateName}</span> está en estado{" "}
            <strong>{plantilla.estado}</strong> en Meta: todavía no se puede enviar. El sistema detecta solo cuando Meta
            la apruebe y habilita el envío.
          </Alert>
        ) : (
          <Alert tono="info">
            Todavía no hay confirmación de Meta sobre la plantilla{" "}
            <span className="font-mono text-xs">{plantilla.templateName}</span>. Podés cargar y detectar clientes ahora;
            cuando Meta apruebe la plantilla el sistema lo detecta y habilita el envío.
          </Alert>
        ))}

      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}

      {/* Carga del Excel */}
      <Card padding="p-6" className="max-w-2xl">
        <form onSubmit={subir} className="space-y-4">
          <p className="text-sm text-ink-muted">
            Subí el Excel (.xls o .xlsx): la lista de turnos de taller o la planilla de ventas. No hace falta que elijas
            cuál es, el sistema lo reconoce por las columnas y aplica la regla que corresponde a cada una.
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
              descripcion="Subí el primer Excel (turnos de taller o planilla de ventas) para armar la lista de destinatarios."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
                  <th className="px-4 py-2">Archivo</th>
                  <th className="px-4 py-2">Planilla</th>
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
                    <td className="px-4 py-2">
                      <Badge tono={c.origen === "VENTAS" ? "morado" : "azul"} className="cursor-default">
                        {LABEL_ORIGEN[c.origen]}
                      </Badge>
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
                        {c.pendientes + c.errores > 0 && (
                          <button
                            onClick={() => enviar(c.id)}
                            disabled={plantilla ? !plantilla.puedeEnviar : false}
                            className={claseBoton("primario", "!py-1 !px-2 !text-xs")}
                            title={
                              plantilla && !plantilla.puedeEnviar
                                ? "La plantilla todavía no está aprobada por Meta"
                                : `Enviar recordatorio a ${c.pendientes + c.errores} cliente(s)`
                            }
                          >
                            <Send className="h-3.5 w-3.5" /> Enviar ({c.pendientes + c.errores})
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
      {detalle && (
        <DetalleClientes
          detalle={detalle}
          puedeEnviar={plantilla ? plantilla.puedeEnviar : true}
          onEnviar={() => enviar(detalle.upload.id)}
          onCerrar={() => setDetalle(null)}
        />
      )}
    </div>
  );
}

function DetalleClientes({
  detalle,
  puedeEnviar,
  onEnviar,
  onCerrar,
}: {
  detalle: DetalleCarga;
  puedeEnviar: boolean;
  onEnviar: () => void;
  onCerrar: () => void;
}) {
  const { upload, clientes } = detalle;
  const esVentas = upload.origen === "VENTAS";
  // "Por enviar" = pendientes + los que quedaron en error (se reintentan).
  const porEnviar = clientes.filter((c) => c.estado === "PENDIENTE" || c.estado === "ERROR").length;
  // Desglose por service: solo tiene sentido en las cargas de turnos, que son
  // las únicas que traen el dato.
  const porServicio = clientes.reduce<Record<number, number>>((acc, c) => {
    if (c.numeroServicio === null) return acc;
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
            <Badge tono={esVentas ? "morado" : "azul"} className="cursor-default">
              {LABEL_ORIGEN[upload.origen]}
            </Badge>
            {esVentas
              ? null
              : [1, 2, 3, 4, 5].map((n) =>
                  porServicio[n] ? (
                    <Badge key={n} tono="morado">{n}° service: {porServicio[n]}</Badge>
                  ) : null
                )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {porEnviar > 0 && (
            <button
              onClick={onEnviar}
              disabled={!puedeEnviar}
              className={claseBoton("primario", "!py-1.5")}
              title={puedeEnviar ? undefined : "La plantilla todavía no está aprobada por Meta"}
            >
              <Send className="h-4 w-4" /> Enviar recordatorios ({porEnviar})
            </button>
          )}
          <button onClick={onCerrar} className={claseBoton("fantasma", "border border-gray-300 !py-1.5")}>Cerrar</button>
        </div>
      </div>
      <div className="max-h-[28rem] overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              {/* Las cargas de ventas no traen service; ahí lo útil es la entrega. */}
              <th className="px-4 py-2 text-center">{esVentas ? "Entrega" : "Service"}</th>
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
                <td className="px-4 py-2 text-center font-semibold text-ink">
                  {esVentas
                    ? c.fechaEntrega
                      ? fechaCorta(c.fechaEntrega)
                      : "—"
                    : c.numeroServicio !== null
                      ? `${c.numeroServicio}°`
                      : "—"}
                </td>
                <td className="px-4 py-2 text-ink">{c.nombre}</td>
                <td className="px-4 py-2 text-ink-muted">{c.telefono || "—"}</td>
                <td className="px-4 py-2 text-ink-muted">{c.modelo || "—"}</td>
                <td className="px-4 py-2">
                  <Badge tono={TONO_ESTADO[c.estado]}>{LABEL_ESTADO[c.estado]}</Badge>
                </td>
                <td className="px-4 py-2 text-xs text-ink-muted" title={c.comentarioAsesor ?? undefined}>
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
