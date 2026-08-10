import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDown, MessageSquarePlus, Pencil, RotateCcw, Send, SearchX, Trash2, UserPlus } from "lucide-react";
import { apiDelete, apiDescargarArchivo, apiGet, apiPostJson } from "../lib/api";
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
  whatsappOptOut: boolean;
  suprimido: boolean;
  ultimoErrorEnvio: string | null;
  periodo: string;
  ultimoAnalisis: { semaforo: string; esHistoricoImportado: boolean } | null;
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
  sucursal: string;
  asesor: string;
  periodo: string;
  fechaDesde: string;
  fechaHasta: string;
  origenAgendamiento: string;
  estadoContacto: string;
  area: string;
}

const FILTROS_INICIALES: Filtros = {
  sucursal: "",
  asesor: "",
  periodo: "",
  fechaDesde: "",
  fechaHasta: "",
  origenAgendamiento: "",
  estadoContacto: "",
  area: "",
};

const ESTADOS_CONTACTO = ["PENDIENTE", "ENVIADO", "RESPONDIDO", "NO_RESPONDIO", "INTERNO", "ERROR"];
const ORIGENES = ["DEALER", "FORDPASS", "ONLINEBOOKING", "OTRO"];

const BADGE_ESTADO: Record<string, { tono: "gris" | "azul" | "verde" | "amarillo" | "morado" | "rojo"; etiqueta: string }> = {
  PENDIENTE: { tono: "gris", etiqueta: "Pendiente" },
  ENVIADO: { tono: "azul", etiqueta: "Enviado" },
  RESPONDIDO: { tono: "verde", etiqueta: "Respondido" },
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
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES);
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

  // Modal de confirmación de envío
  const [modal, setModal] = useState<{
    modo: "seleccion" | "filtro";
    plantilla: "contacto" | "respuesta_no_recibida";
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
      if (filtros.sucursal.trim()) params.set("sucursal", filtros.sucursal.trim());
      if (filtros.asesor.trim()) params.set("asesor", filtros.asesor.trim());
      if (filtros.periodo.trim()) params.set("periodo", filtros.periodo.trim());
      if (filtros.fechaDesde.trim()) params.set("fechaDesde", filtros.fechaDesde.trim());
      if (filtros.fechaHasta.trim()) params.set("fechaHasta", filtros.fechaHasta.trim());
      if (filtros.origenAgendamiento) params.set("origenAgendamiento", filtros.origenAgendamiento);
      if (filtros.estadoContacto) params.set("estadoContacto", filtros.estadoContacto);
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
    plantilla: "contacto" | "respuesta_no_recibida" = "contacto"
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
          <span className="ml-auto text-sm text-ink-muted">
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
                <tr key={c.id} className="border-b border-gray-100 transition-colors hover:bg-gray-50">
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
                        <PuntoSemaforo semaforo={c.ultimoAnalisis.semaforo} soloIcono />
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
                : "Confirmar envío de WhatsApp"}
            </h3>
            <p className="mt-3 text-sm text-ink-muted">{modal.mensaje}</p>
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
          sucursales={opciones.sucursales}
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
          sucursales={opciones.sucursales}
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
