import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileDown, MessageSquarePlus, Pencil, RotateCcw, Search, Send, SearchX, Trash2, UserPlus, Phone } from "lucide-react";
import { apiDelete, apiDescargarArchivo, apiGet, apiPostJson } from "../lib/api";
import { getMarca } from "../lib/marca";
import { PanelLlamada } from "../components/PanelLlamada";
import { getModoDemo, getUsuario, veTodasLasAreas } from "../lib/auth";
import { AREAS, etiquetaArea, tonoArea } from "../lib/area";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge, PuntoSemaforo } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { Campo, Input, Select } from "../components/ui/Field";
import { SkeletonTableRows } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { ConfirmarEliminacion } from "../components/ui/ConfirmarEliminacion";
import { NuevoCasoModal } from "../components/NuevoCasoModal";

// ---------- Tipos ----------

interface Caso {
  id: string;
  numeroOrden: string;
  fechaProgramacion: string;
  origenAgendamiento: string;
  asesor: string;
  modelo: string;
  patente: string;
  nombrePropietario: string;
  whatsapp: string;
  celular: string;
  emailPropietario: string | null;
  comentarioAsesor: string | null;
  sucursal: string;
  area: string;
  estadoContacto: string;
  // ¿Le lavaron el auto en esta visita? false = no, y entonces no se le
  // preguntó por el lavado ni se puede cargar a mano. null = no se sabe.
  tuvoLavado: boolean | null;
  whatsappOptOut: boolean;
  suprimido: boolean;
  ultimoErrorEnvio: string | null;
  periodo: string;
  ultimoAnalisis: {
    semaforo: string;
    // Puntaje 1-5 en las marcas que miden por estrellas (null en las demas).
    estrellas: number | null;
    esHistoricoImportado: boolean;
  } | null;
}

interface CasosResponse {
  data: Caso[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

interface Progreso {
  enCola: number;
  enviando: number;
  completados: number;
  fallidos: number;
}

interface Filtros {
  busqueda: string;
  sucursal: string;
  asesor: string;
  periodo: string;
  fechaDesde: string;
  fechaHasta: string;
  origenAgendamiento: string;
  estadoContacto: string;
  // "si" / "no" / "": si al cliente ya se le insistió (segundo contacto).
  insistido: string;
  area: string;
}

const FILTROS_INICIALES: Filtros = {
  busqueda: "",
  sucursal: "",
  asesor: "",
  periodo: "",
  fechaDesde: "",
  fechaHasta: "",
  origenAgendamiento: "",
  estadoContacto: "",
  insistido: "",
  area: "",
};

// LLAMADA_PENDIENTE y RESPONDIO_LLAMADA son del circuito de insistencia, que
// hoy solo corre en Volkswagen. Se listan igual en las dos marcas: son estados
// que ya existen en la base, y si no estuvieran aca un caso que quedo en uno de
// ellos no se podria filtrar ni se veria con etiqueta, solo con el codigo crudo.
const ESTADOS_CONTACTO = [
  "PENDIENTE",
  "ENVIADO",
  "RESPONDIDO",
  "LLAMADA_PENDIENTE",
  "RESPONDIO_LLAMADA",
  "NO_RESPONDE_CONTACTOS",
  "NO_RESPONDIO",
  "INTERNO",
  "ERROR",
];
const ORIGENES = ["DEALER", "FORDPASS", "ONLINEBOOKING", "OTRO"];

const BADGE_ESTADO: Record<string, { tono: "gris" | "azul" | "verde" | "amarillo" | "morado" | "rojo"; etiqueta: string }> = {
  PENDIENTE: { tono: "gris", etiqueta: "Pendiente" },
  ENVIADO: { tono: "azul", etiqueta: "Enviado" },
  RESPONDIDO: { tono: "verde", etiqueta: "Respondido" },
  // Rojo a proposito: es el unico estado que pide que ALGUIEN HAGA ALGO a mano
  // (levantar el telefono). Con el mismo tono que los demas se perderia en la
  // lista, que es justo lo que no puede pasar con una tarea pendiente.
  LLAMADA_PENDIENTE: { tono: "rojo", etiqueta: "3° contacto pendiente" },
  RESPONDIO_LLAMADA: { tono: "verde", etiqueta: "Respondió (llamada)" },
  // Gris y no rojo: no es una falla ni algo que haya que atender, es un caso
  // cerrado. El rojo tiene que quedar reservado para lo que pide accion.
  NO_RESPONDE_CONTACTOS: { tono: "gris", etiqueta: "No responde contactos" },
  NO_RESPONDIO: { tono: "amarillo", etiqueta: "No respondió" },
  INTERNO: { tono: "morado", etiqueta: "Interno" },
  ERROR: { tono: "rojo", etiqueta: "Error" },
};

function fechaCorta(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// ---------- Componente ----------

export default function Casos() {
  // El perfil de la marca decide si esta pantalla muestra lo del circuito de
  // insistencia. En Ford no existe y esas partes no se dibujan.
  const marcaInfo = getMarca();
  // Qué caso tiene abierto el panel de la llamada. Uno a la vez: el panel es
  // alto y con varios abiertos la lista se vuelve ilegible.
  const [llamadaAbierta, setLlamadaAbierta] = useState<string | null>(null);
  // El cartel de avisos linkea acá con ?busqueda=<nro de orden> (p. ej. desde un
  // "posible duplicado", donde lo que hace falta es comparar las dos cargas).
  // Sin esto la pantalla ignoraba el parámetro y el botón no hacía nada.
  const [searchParams] = useSearchParams();
  const busquedaInicial = (searchParams.get("busqueda") ?? "").trim();

  const [filtros, setFiltros] = useState<Filtros>({
    ...FILTROS_INICIALES,
    busqueda: busquedaInicial,
  });
  const [page, setPage] = useState(1);
  const [respuesta, setRespuesta] = useState<CasosResponse | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opciones reales para los desplegables de filtros (sucursal/asesor/período),
  // en vez de texto libre (sensible a tildes y a errores de tipeo).
  const [opciones, setOpciones] = useState<{ sucursales: string[]; asesores: string[]; periodos: string[] }>({
    sucursales: [],
    asesores: [],
    periodos: [],
  });
  const cargarOpciones = useCallback(() => {
    apiGet<{ sucursales: string[]; asesores: string[]; periodos: string[] }>("/api/casos/opciones")
      .then(setOpciones)
      .catch(() => {
        /* si falla, los desplegables quedan vacíos; no es bloqueante */
      });
  }, []);
  useEffect(() => {
    cargarOpciones();
  }, [cargarOpciones]);

  // Alta manual de un caso suelto (el que no vino en el Excel)
  const [nuevoCaso, setNuevoCaso] = useState(false);
  // Edición de un caso existente (corregir datos mal cargados)
  const [casoEditar, setCasoEditar] = useState<Caso | null>(null);

  const hayFiltros = Object.values(filtros).some((v) => v.trim() !== "");

  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());

  // Buscador por N° de orden con debounce: el input responde al instante y el
  // filtro que dispara la carga se actualiza 350ms después de dejar de tipear
  // (así no se llama a la API en cada tecla).
  const [busquedaInput, setBusquedaInput] = useState(busquedaInicial);
  useEffect(() => {
    const v = busquedaInput.trim();
    if (v === filtros.busqueda) return;
    const t = setTimeout(() => {
      setFiltros((prev) => ({ ...prev, busqueda: v }));
      setPage(1);
      setSeleccion(new Set());
    }, 350);
    return () => clearTimeout(t);
  }, [busquedaInput, filtros.busqueda]);

  // Modal de confirmación de envío
  const [modal, setModal] = useState<{
    modo: "seleccion" | "filtro";
    plantilla: "contacto" | "respuesta_no_recibida" | "segundo_contacto";
    destinatarios: number;
    mensaje: string;
  } | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  // Progreso del envío (polling)
  const [progreso, setProgreso] = useState<Progreso | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Borrado (solo ADMIN): con confirmación tipeada del número de orden
  const esAdmin = getUsuario()?.rol === "ADMIN";
  const puedeFiltrarArea = veTodasLasAreas(getUsuario()); // filtro de área solo si ve más de una
  const modoDemo = getModoDemo();
  const [aEliminar, setAEliminar] = useState<Caso | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  // La columna va siempre: el botón de reintentar un envío fallido lo necesita
  // cualquier usuario, no solo ADMIN.
  const columnas = 13;

  // Reintento de un envío fallido: el caso queda en ERROR y las campañas solo
  // alcanzan PENDIENTE, así que sin esto no habría forma de recuperarlo.
  const [reintentando, setReintentando] = useState<string | null>(null);

  async function reintentarEnvio(caso: Caso) {
    setReintentando(caso.id);
    setError(null);
    try {
      const { message } = await apiPostJson<{ message: string }>(`/api/campanas/reintentar/${caso.id}`, {});
      setMensaje(message);
      iniciarPolling(); // muestra la barra de progreso como en una campaña
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos reintentar el envío.");
    } finally {
      setReintentando(null);
    }
  }

  // Modo demo: simular una respuesta entrante del cliente
  const [simularCaso, setSimularCaso] = useState<Caso | null>(null);
  const [textoSimulado, setTextoSimulado] = useState("");
  const [simulando, setSimulando] = useState(false);

  async function confirmarSimular() {
    if (!simularCaso || !textoSimulado.trim()) return;
    setSimulando(true);
    setError(null);
    try {
      const { message } = await apiPostJson<{ message: string }>("/api/demo/simular-respuesta", {
        casoId: simularCaso.id,
        texto: textoSimulado.trim(),
      });
      setMensaje(message);
      setSimularCaso(null);
      setTextoSimulado("");
      // Damos unos segundos a que el worker clasifique antes de refrescar
      setTimeout(() => cargarCasos(), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos simular la respuesta.");
    } finally {
      setSimulando(false);
    }
  }

  async function confirmarEliminar() {
    if (!aEliminar) return;
    setEliminando(true);
    setError(null);
    try {
      const { message } = await apiDelete<{ message: string }>(`/api/casos/${aEliminar.id}`);
      setMensaje(message);
      setAEliminar(null);
      setSeleccion(new Set());
      await cargarCasos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos eliminar el caso.");
    } finally {
      setEliminando(false);
    }
  }

  const queryFiltros = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams();
      if (filtros.busqueda.trim()) params.set("busqueda", filtros.busqueda.trim());
      if (filtros.sucursal.trim()) params.set("sucursal", filtros.sucursal.trim());
      if (filtros.asesor.trim()) params.set("asesor", filtros.asesor.trim());
      if (filtros.periodo.trim()) params.set("periodo", filtros.periodo.trim());
      if (filtros.fechaDesde.trim()) params.set("fechaDesde", filtros.fechaDesde.trim());
      if (filtros.fechaHasta.trim()) params.set("fechaHasta", filtros.fechaHasta.trim());
      if (filtros.origenAgendamiento) params.set("origenAgendamiento", filtros.origenAgendamiento);
      if (filtros.estadoContacto) params.set("estadoContacto", filtros.estadoContacto);
      if (filtros.insistido) params.set("insistido", filtros.insistido);
      if (filtros.area) params.set("area", filtros.area);
      for (const [k, v] of Object.entries(extra)) params.set(k, v);
      return params;
    },
    [filtros]
  );

  const cargarCasos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = queryFiltros({ page: String(page), pageSize: "20" });
      const data = await apiGet<CasosResponse>(`/api/casos?${params.toString()}`);
      setRespuesta(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar los casos. Probá recargar la página.");
    } finally {
      setCargando(false);
    }
  }, [queryFiltros, page]);

  useEffect(() => {
    cargarCasos();
  }, [cargarCasos]);

  // Al cambiar filtros se vuelve a la página 1 y se limpia la selección
  function cambiarFiltro<K extends keyof Filtros>(campo: K, valor: string) {
    setFiltros((prev) => ({ ...prev, [campo]: valor }));
    setPage(1);
    setSeleccion(new Set());
  }

  function limpiarFiltros() {
    setFiltros(FILTROS_INICIALES);
    setBusquedaInput("");
    setPage(1);
    setSeleccion(new Set());
  }

  const casos = respuesta?.data ?? [];
  // "Elegible" = se le puede enviar WhatsApp: pendiente, sin baja (opt-out) y
  // sin figurar en la lista de supresión por teléfono.
  const esElegible = (c: Caso) => c.estadoContacto === "PENDIENTE" && !c.whatsappOptOut && !c.suprimido;
  const pendientesEnPagina = useMemo(() => casos.filter(esElegible), [casos]);

  function alternarSeleccion(id: string) {
    setSeleccion((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  function alternarPagina() {
    const todosSeleccionados = pendientesEnPagina.every((c) => seleccion.has(c.id));
    setSeleccion((prev) => {
      const nuevo = new Set(prev);
      for (const c of pendientesEnPagina) {
        if (todosSeleccionados) nuevo.delete(c.id);
        else nuevo.add(c.id);
      }
      return nuevo;
    });
  }

  // ---------- Envío ----------

  async function abrirPreview(
    modo: "seleccion" | "filtro",
    plantilla: "contacto" | "respuesta_no_recibida" | "segundo_contacto" = "contacto"
  ) {
    setError(null);
    try {
      const params =
        modo === "seleccion"
          ? new URLSearchParams({ casoIds: [...seleccion].join(",") })
          : queryFiltros();
      params.delete("estadoContacto"); // la campaña de contacto siempre exige PENDIENTE
      if (plantilla !== "contacto") params.set("plantilla", plantilla);
      const data = await apiGet<{ destinatarios: number; message: string }>(
        `/api/campanas/preview?${params.toString()}`
      );
      setModal({ modo, plantilla, destinatarios: data.destinatarios, mensaje: data.message });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos calcular cuántos mensajes se enviarían.");
    }
  }

  async function confirmarEnvio() {
    if (!modal) return;
    setConfirmando(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      // El área NO va en el body: el backend la lee del query string (igual que
      // el preview). Si no se pasa, enviaría a TODAS las áreas del usuario y no
      // coincidiría con el número previsualizado.
      let qs = "";
      if (modal.modo === "seleccion") {
        body.casoIds = [...seleccion];
      } else {
        // IMPORTANTE: enviar EXACTAMENTE los mismos filtros que el preview, para
        // que el envío coincida con el número mostrado (incluye origen y área).
        if (filtros.busqueda.trim()) body.busqueda = filtros.busqueda.trim();
        if (filtros.sucursal.trim()) body.sucursal = filtros.sucursal.trim();
        if (filtros.asesor.trim()) body.asesor = filtros.asesor.trim();
        if (filtros.periodo.trim()) body.periodo = filtros.periodo.trim();
        if (filtros.fechaDesde.trim()) body.fechaDesde = filtros.fechaDesde.trim();
        if (filtros.fechaHasta.trim()) body.fechaHasta = filtros.fechaHasta.trim();
        if (filtros.origenAgendamiento) body.origenAgendamiento = filtros.origenAgendamiento;
        if (filtros.area) qs = `?area=${encodeURIComponent(filtros.area)}`;
      }
      if (modal.plantilla !== "contacto") body.plantilla = modal.plantilla;
      await apiPostJson<{ encolados: number }>(`/api/campanas/enviar${qs}`, body);
      setModal(null);
      setSeleccion(new Set());
      iniciarPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos iniciar el envío. Probá de nuevo.");
    } finally {
      setConfirmando(false);
    }
  }

  function iniciarPolling() {
    detenerPolling();
    const tick = async () => {
      try {
        const p = await apiGet<Progreso>("/api/campanas/progreso");
        setProgreso(p);
        if (p.enCola === 0 && p.enviando === 0) {
          detenerPolling();
          cargarCasos();
        }
      } catch {
        // si falla un tick, se sigue intentando
      }
    };
    tick();
    pollRef.current = setInterval(tick, 2500);
  }

  function detenerPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => detenerPolling, []);

  // ---------- Render ----------

  return (
    <div className="space-y-4">
      {/* Buscador rápido por N° de orden (o "S/N" para los casos sin número) */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden="true"
        />
        <input
          type="text"
          value={busquedaInput}
          onChange={(e) => setBusquedaInput(e.target.value)}
          placeholder='Buscar por N° de orden…  (escribí "S/N" para ver los casos sin número)'
          aria-label="Buscar por número de orden"
          className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm text-ink placeholder:text-gray-400 focus:border-accent focus:outline-none"
        />
        {busquedaInput && (
          <button
            type="button"
            onClick={() => setBusquedaInput("")}
            aria-label="Limpiar búsqueda"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-ink"
          >
            <SearchX className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Filtros */}
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {puedeFiltrarArea && (
          <Campo etiqueta="Área">
            <Select value={filtros.area} onChange={(e) => cambiarFiltro("area", e.target.value)}>
              <option value="">Ambas</option>
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {etiquetaArea(a)}
                </option>
              ))}
            </Select>
          </Campo>
        )}
        <Campo etiqueta="Sucursal">
          <Select value={filtros.sucursal} onChange={(e) => cambiarFiltro("sucursal", e.target.value)}>
            <option value="">Todas</option>
            {opciones.sucursales.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo etiqueta="Asesor">
          <Select value={filtros.asesor} onChange={(e) => cambiarFiltro("asesor", e.target.value)}>
            <option value="">Todos</option>
            {opciones.asesores.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo etiqueta="Período">
          <Select value={filtros.periodo} onChange={(e) => cambiarFiltro("periodo", e.target.value)}>
            <option value="">Todos</option>
            {opciones.periodos.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo etiqueta="Fecha desde">
          <Input
            type="date"
            value={filtros.fechaDesde}
            max={filtros.fechaHasta || undefined}
            onChange={(e) => cambiarFiltro("fechaDesde", e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Fecha hasta">
          <Input
            type="date"
            value={filtros.fechaHasta}
            min={filtros.fechaDesde || undefined}
            onChange={(e) => cambiarFiltro("fechaHasta", e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Origen">
          <Select value={filtros.origenAgendamiento} onChange={(e) => cambiarFiltro("origenAgendamiento", e.target.value)}>
            <option value="">Todos</option>
            {ORIGENES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Campo>
        {/* Responde la pregunta que se hace Calidad antes de agarrar el telefono:
            a este cliente, ¿ya le insistimos o no? Antes habia que abrir caso por
            caso para saberlo. */}
        {marcaInfo.modulos.segundoContacto && (
          <Campo etiqueta="Insistencia">
            <Select value={filtros.insistido} onChange={(e) => cambiarFiltro("insistido", e.target.value)}>
              <option value="">Todos</option>
              <option value="no">Todavía sin insistir</option>
              <option value="si">Ya se le insistió</option>
            </Select>
          </Campo>
        )}
        <Campo etiqueta="Estado de contacto">
          <Select value={filtros.estadoContacto} onChange={(e) => cambiarFiltro("estadoContacto", e.target.value)}>
            <option value="">Todos</option>
            {ESTADOS_CONTACTO.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Campo>
      </Card>

      {hayFiltros && (
        <div className="-mt-1 flex justify-end">
          <button onClick={limpiarFiltros} className="text-sm font-medium text-accent-dark hover:underline">
            Limpiar filtros
          </button>
        </div>
      )}

      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}

      {/* Barra de progreso del envío */}
      {progreso && (
        <Alert tono="info">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-medium">
              {progreso.enCola + progreso.enviando > 0 ? "Enviando WhatsApp…" : "Envío finalizado"}
            </span>
            <span>En cola: {progreso.enCola}</span>
            <span>Enviando: {progreso.enviando}</span>
            <span>Completados: {progreso.completados}</span>
            <span className={progreso.fallidos > 0 ? "font-medium text-red-700" : ""}>
              Fallidos: {progreso.fallidos}
            </span>
            {progreso.enCola + progreso.enviando === 0 && (
              <button onClick={() => setProgreso(null)} className="ml-auto text-accent-dark underline">
                Cerrar
              </button>
            )}
          </div>
        </Alert>
      )}

      {/* Acciones de envío */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => abrirPreview("seleccion")}
          disabled={seleccion.size === 0}
          className={claseBoton("primario")}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Enviar WhatsApp a seleccionados ({seleccion.size})
        </button>
        <button onClick={() => abrirPreview("filtro")} className={claseBoton("secundario")}>
          Enviar a todos los pendientes del filtro actual
        </button>
        <button
          onClick={() => abrirPreview("filtro", "respuesta_no_recibida")}
          className={claseBoton("secundario")}
          title="Manda la plantilla 'no nos llegó tu mensaje' a todos los clientes contactables del filtro actual (para respuestas que se perdieron). Ignora el estado y la selección."
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Pedir que repitan el mensaje
        </button>
        {/* Solo en las marcas con circuito de insistencia. El backend igual lo
            rechaza, pero mostrar un boton que siempre falla es peor que no
            mostrarlo. */}
        {marcaInfo.modulos.segundoContacto && (
          <button
            onClick={() => abrirPreview("filtro", "segundo_contacto")}
            className={claseBoton("secundario")}
            title="Manda la plantilla de segundo contacto a todos los clientes del filtro actual que ya recibieron el primero y no contestaron. A cada cliente se le insiste UNA sola vez."
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Insistir ahora
          </button>
        )}
        <button
          onClick={() => setNuevoCaso(true)}
          className={claseBoton("secundario")}
          title="Cargar a mano un cliente que no vino en el Excel"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Agregar caso
        </button>
        <button
          onClick={() =>
            apiDescargarArchivo(`/api/casos/exportar?${queryFiltros().toString()}`, "casos.xlsx").catch((err) =>
              setError(err instanceof Error ? err.message : "No pudimos exportar los casos.")
            )
          }
          className={claseBoton("secundario")}
          title="Descargar a Excel todos los casos del filtro actual (si no hay filtros, todos)"
        >
          <FileDown className="h-4 w-4" aria-hidden="true" />
          Exportar a Excel
        </button>
        {respuesta && (
          // El contador va al final de la barra. Cuando los botones no entran y
          // la barra se parte en dos renglones, el ml-auto lo dejaba solo y
          // pegado a la derecha, como suelto; con basis-full baja prolijo
          // ocupando el renglon entero. Y sin nowrap se partia en tres lineas.
          <span className="ml-auto basis-full whitespace-nowrap text-sm text-ink-muted sm:basis-auto">
            {respuesta.pagination.total} caso(s) — página {respuesta.pagination.page} de{" "}
            {respuesta.pagination.totalPages}
          </span>
        )}
      </div>
      <p className="-mt-1 text-xs text-ink-muted">
        <strong>Seleccionados:</strong> se marcan con los casilleros (se mantienen al cambiar de página; el casillero del
        encabezado marca solo los pendientes de <em>esta</em> página). <strong>Todos los pendientes del filtro:</strong>{" "}
        ignora la selección y usa los filtros de arriba. En ambos casos, el preview confirma el número exacto antes de enviar.
      </p>
      {casos.length > 0 && pendientesEnPagina.length === 0 && (
        <p className="-mt-2 text-xs font-medium text-amber-700">
          En esta página no hay casos <strong>pendientes</strong>, así que no hay nada para seleccionar. Solo se puede
          enviar WhatsApp a casos en estado “Pendiente”: filtrá por <em>Estado de contacto → PENDIENTE</em> para verlos.
        </p>
      )}

      {/* Tabla */}
      <Card padding="p-0" className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
              <th className="px-3 py-2">
                {/* Se deshabilita cuando no hay nada elegible en la página: si no,
                    el usuario clickea y "no pasa nada" sin entender por qué. */}
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-accent disabled:cursor-not-allowed disabled:opacity-30"
                  disabled={pendientesEnPagina.length === 0}
                  checked={pendientesEnPagina.length > 0 && pendientesEnPagina.every((c) => seleccion.has(c.id))}
                  onChange={alternarPagina}
                  title={
                    pendientesEnPagina.length === 0
                      ? "No hay casos pendientes en esta página. Solo se puede enviar WhatsApp a casos en estado Pendiente."
                      : `Marca/desmarca los ${pendientesEnPagina.length} caso(s) pendiente(s) de ESTA página (la selección se mantiene entre páginas)`
                  }
                />
              </th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Orden</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Modelo</th>
              <th className="px-3 py-2">Asesor</th>
              <th className="px-3 py-2">Sucursal</th>
              <th className="px-3 py-2">Área</th>
              <th className="px-3 py-2">Período</th>
              <th className="px-3 py-2">WhatsApp</th>
              <th className="px-3 py-2">Semáforo</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {respuesta === null && cargando && <SkeletonTableRows filas={8} columnas={11} />}
            {casos.map((c) => {
              const badge = BADGE_ESTADO[c.estadoContacto] ?? BADGE_ESTADO.PENDIENTE;
              const elegible = esElegible(c);
              return (
                <Fragment key={c.id}>
                <tr className="border-b border-gray-100 transition-colors hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent disabled:opacity-30"
                      disabled={!elegible}
                      checked={seleccion.has(c.id)}
                      onChange={() => alternarSeleccion(c.id)}
                      title={
                        elegible
                          ? ""
                          : c.suprimido
                            ? "El cliente está en la lista de supresión (no contactar): no se le envían mensajes"
                            : c.whatsappOptOut
                              ? "El cliente pidió la baja (BAJA/STOP): no se le envían mensajes"
                              : "Solo se pueden enviar mensajes a casos pendientes"
                      }
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-muted">
                    {fechaCorta(c.fechaProgramacion)}
                  </td>
                  <td className="px-3 py-2 font-medium text-ink">{c.numeroOrden}</td>
                  <td className="px-3 py-2 text-ink">{c.nombrePropietario}</td>
                  <td className="px-3 py-2 text-ink-muted">{c.modelo}</td>
                  <td className="px-3 py-2 text-ink-muted">{c.asesor}</td>
                  <td className="px-3 py-2 text-ink-muted">{c.sucursal}</td>
                  <td className="px-3 py-2">
                    <Badge tono={tonoArea(c.area)} className="cursor-default">
                      {etiquetaArea(c.area)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{c.periodo}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-muted">
                    {c.whatsapp || c.celular || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {c.ultimoAnalisis ? (
                      <span
                        title={
                          c.ultimoAnalisis.esHistoricoImportado
                            ? "Clasificación histórica importada del Excel"
                            : "Clasificado por IA"
                        }
                      >
                        <PuntoSemaforo
                          semaforo={c.ultimoAnalisis.semaforo}
                          estrellas={c.ultimoAnalisis.estrellas}
                          soloIcono
                        />
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      tono={badge.tono}
                      className="cursor-default"
                      title={c.estadoContacto === "ERROR" && c.ultimoErrorEnvio ? c.ultimoErrorEnvio : undefined}
                    >
                      {badge.etiqueta}
                    </Badge>
                    {c.suprimido ? (
                      <Badge tono="rojo" className="ml-1 cursor-default" title="En la lista de supresión por teléfono: no contactar">
                        no contactar
                      </Badge>
                    ) : c.whatsappOptOut ? (
                      <Badge tono="rojo" className="ml-1 cursor-default" title="El cliente pidió la baja (BAJA/STOP): no recibe mensajes">
                        baja
                      </Badge>
                    ) : null}
                  </td>
                  {
                    <td className="whitespace-nowrap px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-3">
                        {/* Envío fallido: sin este botón el caso queda varado,
                            porque las campañas solo alcanzan casos PENDIENTE. */}
                        {c.estadoContacto === "ERROR" && !c.whatsappOptOut && !c.suprimido && (
                          <button
                            onClick={() => reintentarEnvio(c)}
                            disabled={reintentando === c.id}
                            className="inline-flex items-center gap-1 text-xs font-medium text-accent-dark hover:underline disabled:opacity-50"
                            title={c.ultimoErrorEnvio ? `Reintentar. Falló con: ${c.ultimoErrorEnvio}` : "Reintentar el envío"}
                          >
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                            {reintentando === c.id ? "Reintentando…" : "Reintentar"}
                          </button>
                        )}
                        {/* El 3° contacto es el único estado que pide que alguien
                            levante el teléfono. El botón abre acá mismo el mismo
                            formulario que la pantalla del caso, para poder cargar
                            varias llamadas seguidas sin entrar y salir de cada una.
                            Sobre un caso YA cerrado por teléfono, el mismo botón
                            sirve para corregir lo que se cargó: la nota se tipea
                            apurado mientras se habla y equivocarse es normal. */}
                        {marcaInfo.modulos.segundoContacto &&
                          ["LLAMADA_PENDIENTE", "RESPONDIO_LLAMADA", "NO_RESPONDE_CONTACTOS"].includes(
                            c.estadoContacto
                          ) && (
                            <button
                              onClick={() => setLlamadaAbierta(llamadaAbierta === c.id ? null : c.id)}
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                                c.estadoContacto === "RESPONDIO_LLAMADA"
                                  ? llamadaAbierta === c.id
                                    ? "bg-gray-200 text-ink"
                                    : "text-ink-muted hover:bg-gray-100"
                                  : llamadaAbierta === c.id
                                    ? "bg-red-100 text-red-800"
                                    : "text-red-700 hover:bg-red-50"
                              }`}
                              title={
                                c.estadoContacto === "RESPONDIO_LLAMADA"
                                  ? "Corregir la calificación o el comentario de la llamada"
                                  : c.estadoContacto === "NO_RESPONDE_CONTACTOS"
                                    ? "Si al final lo pudiste hablar, cargá acá lo que dijo"
                                    : "Cargar lo que dijo el cliente por teléfono"
                              }
                            >
                              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                              {llamadaAbierta === c.id
                                ? "Cerrar"
                                : c.estadoContacto === "RESPONDIO_LLAMADA"
                                  ? "Editar llamada"
                                  : "Cargar llamada"}
                            </button>
                          )}
                        {/* Editar datos del caso (corregir cargas erróneas). */}
                        <button
                          onClick={() => setCasoEditar(c)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-accent-dark hover:underline"
                          title="Editar los datos del caso"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          Editar
                        </button>
                        {modoDemo && c.estadoContacto === "ENVIADO" && (
                          <button
                            onClick={() => {
                              setSimularCaso(c);
                              setTextoSimulado("");
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-accent-dark hover:underline"
                            title="Simular una respuesta entrante del cliente (modo demo)"
                          >
                            <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
                            Simular respuesta
                          </button>
                        )}
                        {esAdmin && (
                          <button
                            onClick={() => setAEliminar(c)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline"
                            title="Eliminar caso (borrado lógico, recuperable)"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  }
                </tr>
                {llamadaAbierta === c.id && (
                  <tr className="border-b border-gray-100">
                    <td colSpan={columnas} className="p-0">
                      <div className="motion-safe:animate-fade-slide-in">
                        <PanelLlamada
                          casoId={c.id}
                          area={c.area}
                          estado={c.estadoContacto}
                          puntajesPosventa={
                            c.tuvoLavado === false
                              ? marcaInfo.posventa.items.filter((i) => i.item !== "LAVADO")
                              : marcaInfo.posventa.items
                          }
                          onListo={async () => {
                            setLlamadaAbierta(null);
                            await cargarCasos();
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {casos.length === 0 && !cargando && (
              <tr>
                <td colSpan={columnas}>
                  <EmptyState
                    icono={SearchX}
                    titulo="No encontramos casos con estos filtros"
                    descripcion="Probá ajustar la sucursal, el período o el estado de contacto."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Paginación */}
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

      {/* Modal de confirmación */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl motion-safe:animate-fade-slide-in">
            <h3 className="font-display text-lg font-semibold text-ink">
              {modal.plantilla === "respuesta_no_recibida"
                ? "Pedir que repitan el mensaje"
                : modal.plantilla === "segundo_contacto"
                  ? "Insistir a los que no contestaron"
                  : "Confirmar envío de WhatsApp"}
            </h3>
            <p className="mt-3 text-sm text-ink-muted">{modal.mensaje}</p>
            {/* Se dice explicito porque es la regla que mas caro sale romper:
                el mensaje le llega a una persona real y no hay como deshacerlo. */}
            {modal.plantilla === "segundo_contacto" && modal.destinatarios > 0 && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                A cada cliente se le insiste <strong>una sola vez</strong>. Los que ya recibieron la
                insistencia no vuelven a entrar en este envío, aunque sigan sin contestar.
              </p>
            )}
            {modal.destinatarios > 0 && (
              <p className="mt-2 text-sm text-ink-muted">
                Los mensajes salen espaciados entre sí para respetar los límites de WhatsApp, así
                que el envío puede tardar unos minutos.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setModal(null)} className={claseBoton("fantasma", "border border-gray-300")}>
                Cancelar
              </button>
              <button
                onClick={confirmarEnvio}
                disabled={confirmando || modal.destinatarios === 0}
                className={claseBoton("primario")}
              >
                {confirmando
                  ? "Encolando…"
                  : modal.plantilla === "respuesta_no_recibida"
                    ? `Pedir a ${modal.destinatarios} cliente(s)`
                    : `Enviar a ${modal.destinatarios} cliente(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alta manual de un caso */}
      {nuevoCaso && (
        <NuevoCasoModal
          asesores={opciones.asesores}
          onCancelar={() => setNuevoCaso(false)}
          onGuardado={(msg) => {
            setNuevoCaso(false);
            setMensaje(msg);
            setError(null);
            cargarOpciones(); // pudo aparecer una sucursal/asesor/período nuevo
            cargarCasos();
          }}
        />
      )}

      {/* Edición de un caso existente (corregir datos mal cargados) */}
      {casoEditar && (
        <NuevoCasoModal
          asesores={opciones.asesores}
          caso={casoEditar}
          onCancelar={() => setCasoEditar(null)}
          onGuardado={(msg) => {
            setCasoEditar(null);
            setMensaje(msg);
            setError(null);
            cargarOpciones(); // pudo cambiar una sucursal/asesor
            cargarCasos();
          }}
        />
      )}

      {/* Modal de simular respuesta del cliente (solo modo demo) */}
      {simularCaso && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl motion-safe:animate-fade-slide-in">
            <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
              <MessageSquarePlus className="h-5 w-5 text-accent" aria-hidden="true" />
              Simular respuesta del cliente
            </h3>
            <p className="mt-2 text-sm text-ink-muted">
              Escribí un mensaje como si {simularCaso.nombrePropietario} respondiera por WhatsApp. El sistema lo
              procesa igual que una respuesta real: lo clasifica con el semáforo y, si corresponde, abre un RQR.
            </p>
            <textarea
              autoFocus
              value={textoSimulado}
              onChange={(e) => setTextoSimulado(e.target.value)}
              rows={4}
              placeholder="Ej: Muy conforme con la atención, el auto quedó impecable. ¡Gracias!"
              className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setSimularCaso(null)}
                disabled={simulando}
                className={claseBoton("fantasma", "border border-gray-300")}
              >
                Cancelar
              </button>
              <button
                onClick={confirmarSimular}
                disabled={simulando || !textoSimulado.trim()}
                className={claseBoton("primario")}
              >
                {simulando ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de eliminación con confirmación tipeada (solo ADMIN) */}
      {aEliminar && (
        <ConfirmarEliminacion
          titulo="Eliminar caso"
          descripcion={`Vas a eliminar el caso de orden ${aEliminar.numeroOrden} (${aEliminar.nombrePropietario}). Es un borrado lógico: deja de aparecer en el sistema pero queda recuperable desde la auditoría.`}
          palabra={aEliminar.numeroOrden}
          etiquetaAccion="Eliminar caso"
          cargando={eliminando}
          onCancelar={() => setAEliminar(null)}
          onConfirmar={confirmarEliminar}
        />
      )}
    </div>
  );
}
