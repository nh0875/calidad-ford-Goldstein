import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Mic,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import { apiGet, apiPatchJson, apiPostJson, ApiError } from "../lib/api";
import { etiquetaArea, tonoArea } from "../lib/area";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";

// ---------- "WhatsApp interno" ----------
// Reemplaza a "Revisión manual". Como el número del sistema es de la Cloud API
// (no se puede abrir en un celular), acá se ve cada conversación, el estado de
// cada mensaje (si salió / se entregó / se leyó / falló) y se responde a mano.

type Semaforo = "VERDE" | "AMARILLO" | "ROJO" | null;
type Direction = "ENTRANTE" | "SALIENTE";

interface UltimoMensaje {
  content: string;
  direction: Direction;
  createdAt: string;
  status: string;
  mediaTipo: string | null;
}
interface Conversacion {
  id: string;
  numeroOrden: string;
  nombre: string;
  modelo: string;
  asesor: string;
  sucursal: string;
  area: string;
  estadoContacto: string;
  tieneRqrAbierto: boolean;
  optOut: boolean;
  quiereAsesor: boolean;
  semaforo: Semaforo;
  requiereRevision: boolean;
  totalMensajes: number;
  ultimoMensaje: UltimoMensaje | null;
}
interface Mensaje {
  id: string;
  direction: Direction;
  content: string;
  status: string;
  templateName: string | null;
  esAgradecimiento: boolean;
  mediaTipo: string | null;
  waMessageId: string | null;
  createdAt: string;
}
interface Hilo {
  caso: {
    id: string;
    numeroOrden: string;
    nombre: string;
    modelo: string;
    asesor: string;
    sucursal: string;
    area: string;
    estadoContacto: string;
    tieneRqrAbierto: boolean;
    ultimoErrorEnvio: string | null;
    optOut: boolean;
    suprimido: boolean;
    quiereAsesor: boolean;
  };
  mensajes: Mensaje[];
  analisis: { id: string; semaforo: Semaforo; requiereRevisionManual: boolean; resumenIA: string } | null;
  ventana: { abierta: boolean; cierraEn: string | null };
  puedeResponder: { ok: boolean; motivo: string };
  puedeReenviarPlantilla: boolean;
}

const FILTROS: Array<{ valor: "todas" | "revision" | "rojos" | "asesor"; etiqueta: string }> = [
  { valor: "todas", etiqueta: "Todas" },
  { valor: "revision", etiqueta: "Para revisar" },
  { valor: "rojos", etiqueta: "Rojos" },
  { valor: "asesor", etiqueta: "Asesor" },
];

const SEMAFOROS: Array<{ valor: "VERDE" | "AMARILLO" | "ROJO"; etiqueta: string; clase: string }> = [
  { valor: "VERDE", etiqueta: "Verde", clase: "border-green-300 bg-green-50 text-green-800 hover:bg-green-100" },
  { valor: "AMARILLO", etiqueta: "Amarillo", clase: "border-yellow-300 bg-yellow-50 text-yellow-800 hover:bg-yellow-100" },
  { valor: "ROJO", etiqueta: "Rojo", clase: "border-red-300 bg-red-50 text-red-800 hover:bg-red-100" },
];

const PUNTO_SEMAFORO: Record<"VERDE" | "AMARILLO" | "ROJO", string> = {
  VERDE: "bg-green-500",
  AMARILLO: "bg-yellow-500",
  ROJO: "bg-red-500",
};

// Hora/fecha en horario de Argentina. Los timestamps vienen en UTC desde el
// backend; antes se leía el UTC crudo del texto y quedaba 3 h adelantado.
const TZ_AR = "America/Argentina/Buenos_Aires";
function hora(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: TZ_AR });
}
function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: TZ_AR });
}

// Estado de un mensaje NUESTRO (saliente): tilde según el acuse de Meta.
function EstadoMensaje({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "read" || s === "leído" || s === "leido")
    return <span title="Leído" className="inline-flex items-center text-sky-300"><CheckCheck className="h-3.5 w-3.5" /></span>;
  if (s === "delivered" || s === "entregado")
    return <span title="Entregado" className="inline-flex items-center text-white/70"><CheckCheck className="h-3.5 w-3.5" /></span>;
  if (s === "failed" || s === "falló" || s === "fallo" || s === "error")
    return <span title="Falló el envío" className="inline-flex items-center gap-0.5 text-red-200"><AlertTriangle className="h-3 w-3" /></span>;
  // enviado / sent / recibido-nuestro
  return <span title="Enviado" className="inline-flex items-center text-white/70"><Check className="h-3.5 w-3.5" /></span>;
}

function esAudio(m: { mediaTipo: string | null }): boolean {
  return m.mediaTipo === "audio";
}
function contenidoAudioFallido(content: string): boolean {
  return /^\[audio.*\]$/.test(content.trim());
}

export default function Seguimiento() {
  const [params, setParams] = useSearchParams();

  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [filtro, setFiltro] = useState<"todas" | "revision" | "rojos" | "asesor">("todas");
  const [q, setQ] = useState("");
  // Filtros extra (solo aparecen para quien ve más de una provincia / área)
  const [provincia, setProvincia] = useState("");
  const [area, setArea] = useState("");
  const [opciones, setOpciones] = useState<{ provincias: string[]; areas: string[] }>({ provincias: [], areas: [] });
  // Mostrar el badge de área cuando hay más de una en juego (incluye Fidelización):
  // así un usuario de Posventa distingue sus casos de las conversaciones de Fidelización.
  const mostrarArea = opciones.areas.length > 1;
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(params.get("caso"));
  const [hilo, setHilo] = useState<Hilo | null>(null);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [clasificando, setClasificando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  const cargarLista = useCallback(async () => {
    try {
      const url =
        `/api/seguimiento?filtro=${filtro}` +
        (q ? `&q=${encodeURIComponent(q)}` : "") +
        (area ? `&area=${area}` : "") +
        (provincia ? `&sucursal=${encodeURIComponent(provincia)}` : "");
      const r = await apiGet<{ data: Conversacion[]; opciones?: { provincias: string[]; areas: string[] } }>(url);
      setConversaciones(r.data);
      if (r.opciones) setOpciones(r.opciones);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar las conversaciones.");
    }
  }, [filtro, q, area, provincia]);

  const cargarHilo = useCallback(async (casoId: string) => {
    try {
      const r = await apiGet<{ data: Hilo }>(`/api/seguimiento/${encodeURIComponent(casoId)}`);
      setHilo(r.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos abrir la conversación.");
    }
  }, []);

  // Lista: carga + refresco cada 20 s.
  useEffect(() => {
    cargarLista();
    const id = setInterval(cargarLista, 20_000);
    return () => clearInterval(id);
  }, [cargarLista]);

  // Hilo seleccionado: carga + refresco cada 12 s.
  useEffect(() => {
    if (!seleccionadoId) {
      setHilo(null);
      return;
    }
    cargarHilo(seleccionadoId);
    const id = setInterval(() => cargarHilo(seleccionadoId), 12_000);
    return () => clearInterval(id);
  }, [seleccionadoId, cargarHilo]);

  // Bajar al último mensaje cuando cambia el hilo.
  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [hilo?.mensajes.length, seleccionadoId]);

  function seleccionar(casoId: string) {
    setError(null);
    setAviso(null);
    setTexto("");
    setSeleccionadoId(casoId);
    setParams(casoId ? { caso: casoId } : {}, { replace: true });
  }

  async function enviar() {
    if (!seleccionadoId || !texto.trim()) return;
    setEnviando(true);
    setError(null);
    try {
      await apiPostJson(`/api/seguimiento/${encodeURIComponent(seleccionadoId)}/responder`, { texto: texto.trim() });
      setTexto("");
      await cargarHilo(seleccionadoId);
      cargarLista();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar el mensaje.");
    } finally {
      setEnviando(false);
    }
  }

  async function reenviarPlantilla(plantilla: "contacto" | "respuesta_no_recibida") {
    if (!seleccionadoId) return;
    setEnviando(true);
    setError(null);
    setAviso(null);
    try {
      await apiPostJson(`/api/seguimiento/${encodeURIComponent(seleccionadoId)}/reenviar-plantilla`, { plantilla });
      setAviso(
        plantilla === "respuesta_no_recibida"
          ? "Le pedimos al cliente que repita su mensaje. Cuando conteste, se reabre la ventana de 24 hs."
          : "Plantilla reenviada. Cuando el cliente conteste, se reabre la ventana de 24 hs."
      );
      await cargarHilo(seleccionadoId);
      cargarLista();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo reenviar la plantilla.");
    } finally {
      setEnviando(false);
    }
  }

  async function clasificar(semaforo: "VERDE" | "AMARILLO" | "ROJO") {
    if (!hilo?.analisis) return;
    setClasificando(true);
    setError(null);
    try {
      await apiPatchJson(`/api/sentiment-analysis/${hilo.analisis.id}`, { semaforo, requiereRevisionManual: false });
      setAviso(`Clasificado como ${semaforo.toLowerCase()}.`);
      await cargarHilo(hilo.caso.id);
      cargarLista();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la clasificación.");
    } finally {
      setClasificando(false);
    }
  }

  const cierre = useMemo(() => {
    if (!hilo?.ventana.cierraEn) return null;
    return hilo.ventana.cierraEn;
  }, [hilo]);

  return (
    <div className="flex h-[calc(100vh-8.5rem)] overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* ---------- Panel izquierdo: lista de conversaciones ---------- */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-gray-200">
        <div className="space-y-2 border-b border-gray-200 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre u orden…"
              className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          {(opciones.provincias.length > 1 || opciones.areas.length > 1) && (
            <div className="flex gap-1.5">
              {opciones.provincias.length > 1 && (
                <select
                  value={provincia}
                  onChange={(e) => setProvincia(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                >
                  <option value="">Toda provincia</option>
                  {opciones.provincias.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              )}
              {opciones.areas.length > 1 && (
                <select
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                >
                  <option value="">Toda área</option>
                  {opciones.areas.map((a) => (
                    <option key={a} value={a}>{etiquetaArea(a)}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          <div className="flex gap-1">
            {FILTROS.map((f) => (
              <button
                key={f.valor}
                onClick={() => setFiltro(f.valor)}
                className={`flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  filtro === f.valor
                    ? "border-accent bg-accent-light text-accent-dark"
                    : "border-gray-200 text-ink-muted hover:bg-gray-50"
                }`}
              >
                {f.etiqueta}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversaciones.length === 0 ? (
            <p className="p-4 text-center text-xs text-ink-muted">No hay conversaciones para mostrar.</p>
          ) : (
            conversaciones.map((c) => {
              const um = c.ultimoMensaje;
              const activo = c.id === seleccionadoId;
              return (
                <button
                  key={c.id}
                  onClick={() => seleccionar(c.id)}
                  className={`flex w-full items-start gap-2 border-b border-gray-100 px-3 py-2.5 text-left transition-colors ${
                    activo ? "bg-accent-light/60" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="mt-1 flex flex-col items-center gap-1">
                    {c.semaforo && <span className={`h-2.5 w-2.5 rounded-full ${PUNTO_SEMAFORO[c.semaforo]}`} />}
                    {c.requiereRevision && (
                      <span title="Necesita revisión" className="h-2 w-2 rounded-full bg-accent" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">{c.nombre}</span>
                      {um && <span className="shrink-0 text-[11px] text-ink-muted">{fechaCorta(um.createdAt)} {hora(um.createdAt)}</span>}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-ink-muted">
                      {um?.direction === "SALIENTE" && <span className="shrink-0">→</span>}
                      {um && esAudio(um) && <Mic className="h-3 w-3 shrink-0" />}
                      <span className="truncate">
                        {um ? (esAudio(um) && contenidoAudioFallido(um.content) ? "Nota de voz" : um.content) : "Sin mensajes"}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <span className="text-[11px] text-ink-muted">
                        {c.area === "FIDELIZACION" ? c.numeroOrden : `orden ${c.numeroOrden}`} · {c.sucursal}
                      </span>
                      {c.tieneRqrAbierto && <Badge tono="rojo" className="cursor-default !py-0 !text-[10px]">RQR</Badge>}
                      {c.quiereAsesor && <Badge tono="amarillo" className="cursor-default !py-0 !text-[10px]">quiere asesor</Badge>}
                      {c.optOut && <Badge tono="gris" className="cursor-default !py-0 !text-[10px]">baja</Badge>}
                      {mostrarArea && <Badge tono={tonoArea(c.area)} className="cursor-default !py-0 !text-[10px]">{etiquetaArea(c.area)}</Badge>}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ---------- Panel derecho: hilo ---------- */}
      <section className="flex min-w-0 flex-1 flex-col bg-canvas">
        {!hilo ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icono={MessageSquare}
              titulo="Elegí una conversación"
              descripcion="Acá vas a ver el chat completo, si el mensaje salió o falló, y vas a poder responder a mano."
            />
          </div>
        ) : (
          <>
            {/* Encabezado del chat */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-4 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {hilo.analisis?.semaforo && (
                    <span className={`h-2.5 w-2.5 rounded-full ${PUNTO_SEMAFORO[hilo.analisis.semaforo]}`} />
                  )}
                  <span className="truncate font-medium text-ink">{hilo.caso.nombre}</span>
                  {hilo.caso.tieneRqrAbierto && <Badge tono="rojo" className="cursor-default">RQR abierto</Badge>}
                  {hilo.caso.quiereAsesor && <Badge tono="amarillo" className="cursor-default">quiere asesor</Badge>}
                  {mostrarArea && <Badge tono={tonoArea(hilo.caso.area)} className="cursor-default">{etiquetaArea(hilo.caso.area)}</Badge>}
                </div>
                <p className="text-xs text-ink-muted">
                  {hilo.caso.area === "FIDELIZACION" ? hilo.caso.numeroOrden : `orden ${hilo.caso.numeroOrden}`} · {hilo.caso.modelo} · {hilo.caso.sucursal} · asesor {hilo.caso.asesor}
                </p>
              </div>
              {/* Clasificación a mano */}
              {hilo.analisis && (
                <div className="flex items-center gap-1.5">
                  {hilo.analisis.requiereRevisionManual && (
                    <span className="mr-1 text-xs font-medium text-accent-dark">Clasificar:</span>
                  )}
                  {SEMAFOROS.map((s) => (
                    <button
                      key={s.valor}
                      onClick={() => clasificar(s.valor)}
                      disabled={clasificando}
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${s.clase}`}
                    >
                      {s.etiqueta}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {hilo.caso.quiereAsesor && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
                <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
                  <Phone className="h-4 w-4 shrink-0" />
                  El cliente pidió turno con un asesor. Coordinalo y respondele por acá; al responderle sale de pendientes.
                </p>
              </div>
            )}

            {(error || aviso) && (
              <div className="px-4 pt-3">
                {error && <Alert tono="error">{error}</Alert>}
                {aviso && <Alert tono="exito">{aviso}</Alert>}
              </div>
            )}

            {/* Mensajes */}
            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {hilo.mensajes.map((m) => {
                const saliente = m.direction === "SALIENTE";
                const audio = esAudio(m);
                const audioFallido = audio && contenidoAudioFallido(m.content);
                return (
                  <div key={m.id} className={`flex ${saliente ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                        saliente ? "bg-navy text-white" : "bg-white text-ink border border-gray-200"
                      }`}
                    >
                      {(m.templateName || m.esAgradecimiento) && (
                        <p className={`mb-0.5 text-[10px] uppercase tracking-wide ${saliente ? "text-white/50" : "text-ink-muted"}`}>
                          {m.esAgradecimiento ? "Agradecimiento automático" : "Plantilla"}
                        </p>
                      )}
                      {audio ? (
                        <p className="flex items-start gap-1.5">
                          <Mic className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${saliente ? "text-white/70" : "text-ink-muted"}`} />
                          <span className={audioFallido ? "italic opacity-80" : ""}>
                            {audioFallido ? "Nota de voz (no se pudo transcribir)" : m.content}
                          </span>
                        </p>
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      )}
                      <div className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${saliente ? "text-white/60" : "text-ink-muted"}`}>
                        <span>{hora(m.createdAt)}</span>
                        {saliente && <EstadoMensaje status={m.status} />}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={finRef} />
            </div>

            {/* Composer / bloqueo */}
            <div className="border-t border-gray-200 bg-white px-4 py-3">
              {hilo.ventana.abierta && cierre && (
                <p className="mb-1.5 text-[11px] text-ink-muted">
                  Ventana abierta: podés escribirle hasta las {hora(cierre)} de hoy.
                </p>
              )}
              {hilo.puedeResponder.ok ? (
                <div className="flex items-end gap-2">
                  <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        enviar();
                      }
                    }}
                    rows={1}
                    placeholder="Escribí una respuesta…  (Enter envía, Shift+Enter salto de línea)"
                    className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                  <button
                    onClick={enviar}
                    disabled={enviando || !texto.trim()}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    Enviar
                  </button>
                </div>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="flex items-start gap-2 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{hilo.puedeResponder.motivo}</span>
                  </p>
                  {hilo.puedeReenviarPlantilla && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        onClick={() => reenviarPlantilla("contacto")}
                        disabled={enviando}
                        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Reabrir con la plantilla de contacto
                      </button>
                      <button
                        onClick={() => reenviarPlantilla("respuesta_no_recibida")}
                        disabled={enviando}
                        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
                        title="Le pide al cliente que repita su mensaje (para respuestas que se perdieron)"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Pedir que repita el mensaje
                      </button>
                    </div>
                  )}
                </div>
              )}
              {hilo.caso.ultimoErrorEnvio && (
                <p className="mt-1.5 text-[11px] text-red-700">Último error de envío: {hilo.caso.ultimoErrorEnvio}</p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
