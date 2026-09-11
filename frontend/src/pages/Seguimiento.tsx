import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { usaEstrellas } from "../lib/marca";
import { Alert } from "../components/ui/Alert";
import { Badge, PuntoSemaforo } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { PanelLlamada } from "../components/PanelLlamada";

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
  // Puntaje 1-5 en las marcas que miden por estrellas (null en las demas).
  estrellas: number | null;
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
  // Quién lo escribió. null = lo mandó el sistema solo, o es un mensaje viejo
  // (anterior a que se empezara a guardar el autor).
  enviadoPor: { nombre: string } | null;
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
    // Apretó "Quiero participar por Llamada" en la plantilla de Posventa.
    quiereLlamado?: boolean;
    // Circuito de insistencia: cuándo salió el segundo WhatsApp (si salió) y
    // por qué no se pudo hablar en el último intento de llamada.
    segundoContactoEn?: string | null;
    llamadaMotivo?: string | null;
  };
  mensajes: Mensaje[];
  analisis: {
    id: string;
    semaforo: Semaforo;
    estrellas: number | null;
    requiereRevisionManual: boolean;
    resumenIA: string;
  } | null;
  // Los puntajes de la encuesta de Posventa (null en las marcas que no la usan).
  // noAplica = a este caso no se le preguntó ese ítem (hoy: el lavado, cuando al
  // auto no se lo lavaron). Es distinto de "no lo contestó".
  puntajesPosventa: Array<{
    item: string;
    etiqueta: string;
    estrellas: number | null;
    comentario: string | null;
    noAplica: boolean;
  }> | null;
  ventana: { abierta: boolean; cierraEn: string | null };
  puedeResponder: { ok: boolean; motivo: string };
  puedeReenviarPlantilla: boolean;
}

/**
 * Por qué la lista quedó vacía. El backend lo manda SOLO cuando no hay nada que
 * mostrar: es para entender el vacío, no un dato de todos los días.
 */
interface Diagnostico {
  /** Clientes de fidelización de su provincia que todavía no recibieron nada. */
  fidelSinMensajes: number;
  casosConMensajes: number;
  clientesFidelizacionConMensajes: number;
  ocultosPorRol: number;
  ocultosPorProvincia: number;
  tuProvincia: string | null;
  provinciasDeLoOculto: string[];
  hayFiltrosPuestos: boolean;
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

/** El día de un instante, en horario de Argentina, como "2026-09-10". */
function diaAR(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // en-CA da directamente el formato aaaa-mm-dd, que se puede comparar como texto.
  return d.toLocaleDateString("en-CA", { timeZone: TZ_AR });
}

/**
 * Cómo se anuncia un día en el separador.
 *
 * "Hoy" y "Ayer" en vez de la fecha porque es como se habla: quien está mirando
 * una conversación piensa "esto lo contestó ayer", no "esto fue el 09/09". Para
 * lo más viejo se escribe el día con nombre, que ubica mejor que un número
 * suelto; y si es de otro año se agrega, o "12 de marzo" no diría cuál.
 */
function etiquetaDia(iso: string): string {
  const dia = diaAR(iso);
  const hoy = diaAR(new Date().toISOString());
  if (dia === hoy) return "Hoy";

  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  if (dia === diaAR(ayer.toISOString())) return "Ayer";

  const d = new Date(iso);
  const mismoAno = dia.slice(0, 4) === hoy.slice(0, 4);
  return d.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(mismoAno ? {} : { year: "numeric" }),
    timeZone: TZ_AR,
  });
}

/** Fecha y hora completas, para el título de cada mensaje. */
function fechaHoraLarga(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ_AR,
  });
}

/**
 * El vacío, explicado.
 *
 * Antes decía "No hay conversaciones para mostrar" y punto, que es
 * indistinguible de una pantalla rota. Cuando efectivamente hay conversaciones
 * pero quedaron afuera por la provincia o por el rol, decirlo ahorra el rato de
 * ir a revisar por qué —o peor, de dar por hecho que el sistema anda mal—.
 */
function VacioExplicado({ diagnostico }: { diagnostico: Diagnostico | null }) {
  if (!diagnostico) {
    return <p className="p-4 text-center text-xs text-ink-muted">No hay conversaciones para mostrar.</p>;
  }

  const { ocultosPorProvincia, ocultosPorRol, tuProvincia, provinciasDeLoOculto, hayFiltrosPuestos, fidelSinMensajes } =
    diagnostico;
  const total = diagnostico.casosConMensajes + diagnostico.clientesFidelizacionConMensajes;

  return (
    <div className="space-y-2 p-4 text-center text-xs text-ink-muted">
      <p className="font-medium text-ink">No hay conversaciones para mostrar.</p>

      {total === 0 && fidelSinMensajes === 0 && (
        <p>
          Todavía no se mandó ningún WhatsApp: esta pantalla lista las conversaciones que ya empezaron.
        </p>
      )}

      {/* El vacío más común, y el único con una acción clara: los clientes están
          cargados pero nadie les mandó nada todavía. Se ven en "Clientes de
          fidelización" y no acá, porque esto lista CONVERSACIONES y sin mensaje
          no hay conversación. */}
      {fidelSinMensajes > 0 && (
        <p className="rounded-md bg-accent-light/40 px-3 py-2 text-left text-accent-dark">
          Tenés <strong>{fidelSinMensajes}</strong> cliente(s) de fidelización en tu provincia a los que{" "}
          <strong>todavía no se les mandó el recordatorio</strong>. Acá solo aparecen las conversaciones ya
          empezadas: el envío se hace desde la pantalla de Fidelización.
        </p>
      )}

      {ocultosPorProvincia > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-left text-amber-900">
          Hay <strong>{ocultosPorProvincia}</strong> conversación(es) que no ves porque son de otra provincia.
          {tuProvincia ? <> Tu usuario está asignado a <strong>{tuProvincia}</strong>.</> : null}
          {provinciasDeLoOculto.length > 0 && (
            <> Esas conversaciones figuran en: {provinciasDeLoOculto.join(", ")}.</>
          )}
        </p>
      )}

      {ocultosPorRol > 0 && (
        <p>
          Además hay {ocultosPorRol} caso(s) de Contacto Posterior que tu usuario de Fidelización no ve, que es
          como está pensado el puesto.
        </p>
      )}

      {hayFiltrosPuestos && total > 0 && ocultosPorProvincia === 0 && (
        <p>Probá sacando los filtros de arriba: puede que ninguno coincida.</p>
      )}
    </div>
  );
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
  const [diagnostico, setDiagnostico] = useState<Diagnostico | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "revision" | "rojos" | "asesor">("todas");
  const [q, setQ] = useState("");
  // Filtros extra (solo aparecen para quien ve más de una provincia / área)
  const [provincia, setProvincia] = useState("");
  // Rango de días con actividad, para revisar el trabajo de una jornada.
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
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
  // El panel de la llamada abierto sobre un caso YA cerrado por teléfono, para
  // corregir la calificación o el comentario.
  const [editandoLlamada, setEditandoLlamada] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  const cargarLista = useCallback(async () => {
    try {
      const url =
        `/api/seguimiento?filtro=${filtro}` +
        (q ? `&q=${encodeURIComponent(q)}` : "") +
        (area ? `&area=${area}` : "") +
        (provincia ? `&sucursal=${encodeURIComponent(provincia)}` : "") +
        (desde ? `&fechaDesde=${desde}` : "") +
        (hasta ? `&fechaHasta=${hasta}` : "");
      const r = await apiGet<{
        data: Conversacion[];
        opciones?: { provincias: string[]; areas: string[] };
        diagnostico?: Diagnostico | null;
      }>(url);
      setConversaciones(r.data);
      setDiagnostico(r.diagnostico ?? null);
      if (r.opciones) setOpciones(r.opciones);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar las conversaciones.");
    }
  }, [filtro, q, area, provincia, desde, hasta]);

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
    // Cambiar de caso cierra el panel de corrección: si quedara abierto,
    // aparecería con los datos de un cliente sobre la conversación de otro.
    setEditandoLlamada(false);
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

  // Insistir a mano, sin esperar las 24 h del circuito automático. Toda la
  // validación real vive en el backend, que es el mismo camino que usa la
  // barrida: si estuviera duplicada acá, tarde o temprano las dos versiones
  // dirían cosas distintas sobre a quién se le puede escribir.
  async function mandarSegundoContacto() {
    if (!seleccionadoId) return;
    setEnviando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await apiPostJson<{ message: string }>(
        `/api/seguimiento/${encodeURIComponent(seleccionadoId)}/segundo-contacto`,
        {}
      );
      setAviso(r.message);
      await cargarHilo(seleccionadoId);
      cargarLista();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo mandar el segundo contacto.");
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

  // Clasificacion manual. En las marcas que miden por estrellas se manda el
  // puntaje y el backend recalcula el semaforo; en las demas, el semaforo.
  async function clasificar(valor: "VERDE" | "AMARILLO" | "ROJO" | number) {
    if (!hilo?.analisis) return;
    setClasificando(true);
    setError(null);
    try {
      const cuerpo =
        typeof valor === "number"
          ? { estrellas: valor, requiereRevisionManual: false }
          : { semaforo: valor, requiereRevisionManual: false };
      await apiPatchJson(`/api/sentiment-analysis/${hilo.analisis.id}`, cuerpo);
      setAviso(
        typeof valor === "number"
          ? `Clasificado con ${valor} ${valor === 1 ? "estrella" : "estrellas"}.`
          : `Clasificado como ${valor.toLowerCase()}.`
      );
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
    // El alto descuenta lo que hay ARRIBA del chat: el encabezado (~71 px), el
    // padding del contenido (48 px) y el cartel de avisos (47 px colapsado), que
    // se olvidaba en la cuenta. Con 8.5rem el recuadro pedia ~30 px de mas y
    // aparecian DOS barras de scroll, una encima de la otra, y el cuadro para
    // escribir quedaba cortado abajo. Solo lo veia quien tenia avisos en
    // pantalla, y por eso una persona lo sufria y otra no.
    <div className="flex h-[calc(100vh-11rem)] min-h-[24rem] overflow-hidden rounded-lg border border-gray-200 bg-white">
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
          {/* Rango de días. Va SIEMPRE, en las dos marcas: la pregunta "¿a quién
              le escribimos el martes?" no depende de cuántas provincias vea la
              persona. Con un solo extremo cargado también filtra (desde tal día
              en adelante, o hasta tal día). */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={desde}
              max={hasta || undefined}
              onChange={(e) => setDesde(e.target.value)}
              title="Desde qué día"
              className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 font-sans text-xs text-ink transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <span className="text-xs text-ink-muted">a</span>
            <input
              type="date"
              value={hasta}
              min={desde || undefined}
              onChange={(e) => setHasta(e.target.value)}
              title="Hasta qué día"
              className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 font-sans text-xs text-ink transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            {(desde || hasta) && (
              <button
                type="button"
                onClick={() => {
                  setDesde("");
                  setHasta("");
                }}
                title="Quitar el filtro de fechas"
                className="shrink-0 rounded-md px-1.5 py-1 text-xs text-ink-muted transition-colors hover:bg-gray-200 hover:text-ink"
              >
                ✕
              </button>
            )}
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
                  <option value="">Contacto y Fidelización</option>
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
            <VacioExplicado diagnostico={diagnostico} />
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
                    {c.semaforo && <PuntoSemaforo semaforo={c.semaforo} estrellas={c.estrellas} soloIcono />}
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
                    <PuntoSemaforo
                      semaforo={hilo.analisis.semaforo}
                      estrellas={hilo.analisis.estrellas}
                      soloIcono
                    />
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
                  {usaEstrellas()
                    ? [1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => clasificar(n)}
                          disabled={clasificando}
                          title={`Clasificar con ${n} de 5 estrellas`}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-50"
                        >
                          {n} ★
                        </button>
                      ))
                    : SEMAFOROS.map((s) => (
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

            {/* El circuito de insistencia dejó este caso para llamar. Va ARRIBA
                de todo lo demás: es lo único de esta pantalla que pide que
                alguien levante el teléfono ahora. */}
            {(hilo.caso.estadoContacto === "LLAMADA_PENDIENTE" || editandoLlamada) && (
              <PanelLlamada
                casoId={hilo.caso.id}
                area={hilo.caso.area}
                estado={hilo.caso.estadoContacto}
                puntajesPosventa={hilo.puntajesPosventa?.filter((p) => !p.noAplica) ?? null}
                llamadaMotivo={hilo.caso.llamadaMotivo}
                onListo={async () => {
                  setEditandoLlamada(false);
                  await cargarHilo(hilo.caso.id);
                }}
              />
            )}

            {/* Ya se cerró por teléfono: se puede corregir. No se abre solo
                —sería ruido en un caso ya resuelto— pero tiene que estar a mano,
                porque lo que se corrige acá entra en el promedio del asesor y
                puede haber abierto un RQR. */}
            {["RESPONDIO_LLAMADA", "NO_RESPONDE_CONTACTOS"].includes(hilo.caso.estadoContacto) &&
              !editandoLlamada && (
                <div className="border-b border-gray-200 bg-gray-50 px-4 py-2">
                  <button
                    type="button"
                    onClick={() => setEditandoLlamada(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-accent-dark hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                    {hilo.caso.estadoContacto === "RESPONDIO_LLAMADA"
                      ? "Corregir lo que se cargó de la llamada"
                      : "Lo pude hablar: cargar lo que dijo"}
                  </button>
                </div>
              )}

            {hilo.caso.quiereLlamado && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
                <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
                  <Phone className="h-4 w-4 shrink-0" />
                  El cliente prefiere que lo llamen en vez de contestar por WhatsApp. No se le mandó ningún mensaje
                  automático: hay que llamarlo.
                </p>
              </div>
            )}

            {hilo.caso.quiereAsesor && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
                <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
                  <Phone className="h-4 w-4 shrink-0" />
                  El cliente pidió turno con un asesor. Coordinalo y respondele por acá; al responderle sale de pendientes.
                </p>
              </div>
            )}

            {/* Los puntajes de la encuesta de Posventa. Es el POR QUÉ del semáforo
                del caso: sin esto se ve que quedó en 4 estrellas pero no que el
                lavado fue un 1, que es justo el dato por el que se mide por ítem.

                Los ítems que a este caso NO se le preguntaron se muestran igual,
                diciéndolo. Sacarlos de la lista dejaría a quien mira sin saber si
                falta porque no se preguntó o porque el cliente no contestó. */}
            {hilo.puntajesPosventa && hilo.puntajesPosventa.some((p) => p.estrellas !== null) && (
              <div className="border-b border-gray-200 bg-gray-50 px-4 py-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-muted">Encuesta de Posventa</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {hilo.puntajesPosventa.map((p) => (
                    <span key={p.item} className="text-xs" title={p.comentario ?? undefined}>
                      <span className="text-ink-muted">{p.etiqueta}: </span>
                      {p.noAplica ? (
                        <span className="italic text-ink-muted">no se le preguntó (no hubo lavado)</span>
                      ) : p.estrellas === null ? (
                        <span className="text-ink-muted">no contestó</span>
                      ) : (
                        <span
                          className={`font-semibold ${
                            p.estrellas >= 5
                              ? "text-green-700"
                              : p.estrellas >= 4
                                ? "text-yellow-700"
                                : "text-red-700"
                          }`}
                        >
                          {p.estrellas}/5
                        </span>
                      )}
                      {p.comentario && <span className="ml-1 text-ink-muted">“{p.comentario}”</span>}
                    </span>
                  ))}
                </div>
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
              {hilo.mensajes.map((m, i) => {
                const saliente = m.direction === "SALIENTE";
                const audio = esAudio(m);
                const audioFallido = audio && contenidoAudioFallido(m.content);
                // Se separa cuando CAMBIA el día respecto del mensaje anterior.
                // Antes cada globo mostraba solo la hora: en una conversación que
                // duró tres días se leían "14:32" y "09:15" seguidos sin forma de
                // saber si pasaron veinte minutos o dos días entre uno y otro,
                // que es justamente lo que hay que poder ver para seguir un caso.
                const anterior = i > 0 ? hilo.mensajes[i - 1] : null;
                const abreDia = !anterior || diaAR(anterior.createdAt) !== diaAR(m.createdAt);
                return (
                  <Fragment key={m.id}>
                  {abreDia && (
                    <div className="flex items-center gap-3 py-1">
                      <div className="h-px flex-1 bg-gray-200" />
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium capitalize text-ink-muted">
                        {etiquetaDia(m.createdAt)}
                      </span>
                      <div className="h-px flex-1 bg-gray-200" />
                    </div>
                  )}
                  <div className={`flex ${saliente ? "justify-end" : "justify-start"}`}>
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
                      {/* QUIÉN lo mandó. Solo en los salientes, y solo cuando se
                          sabe: los automáticos ya se identifican con su etiqueta
                          de arriba, y los mensajes viejos no tienen el dato
                          guardado (para esos está
                          scripts/windows/quien-mando-el-mensaje.sql). */}
                      <div className={`mt-0.5 flex items-center justify-end gap-1.5 text-[10px] ${saliente ? "text-white/60" : "text-ink-muted"}`}>
                        {saliente && m.enviadoPor && (
                          <span className="truncate" title={`Lo escribió ${m.enviadoPor.nombre}`}>
                            {m.enviadoPor.nombre}
                          </span>
                        )}
                        {saliente && !m.enviadoPor && !m.esAgradecimiento && !m.templateName && (
                          <span className="italic opacity-70" title="Es un mensaje anterior a que el sistema guardara quién lo escribe">
                            autor no registrado
                          </span>
                        )}
                        {/* La fecha va junto a la hora, no solo en el separador:
                            al copiar o citar un mensaje suelto hace falta saber
                            de cuándo es sin tener que buscar el separador arriba. */}
                        <span title={fechaHoraLarga(m.createdAt)}>
                          {fechaCorta(m.createdAt)} {hora(m.createdAt)}
                        </span>
                        {saliente && <EstadoMensaje status={m.status} />}
                      </div>
                    </div>
                  </div>
                  </Fragment>
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

                      {/* Insistir sin esperar las 24 h del circuito automático.
                          Solo aparece si el caso está esperando respuesta y el
                          segundo mensaje TODAVÍA no salió: el peor error de este
                          circuito es que al cliente le llegue dos veces, así que
                          el botón desaparece apenas salió una. */}
                      {hilo.caso.estadoContacto === "ENVIADO" && !hilo.caso.segundoContactoEn && (
                        <button
                          onClick={mandarSegundoContacto}
                          disabled={enviando}
                          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
                          title="Le manda la plantilla de segundo contacto ahora, sin esperar a que lo haga el sistema"
                        >
                          <Send className="h-3.5 w-3.5" />
                          Insistir ahora
                        </button>
                      )}
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
