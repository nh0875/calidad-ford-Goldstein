// Seguimiento de la encuesta de Ford: tareas de refuerzo gestionadas por HUMANOS.
// CALIDAD ve "Mis casos a reforzar"; ADMIN además tiene la vista de administración
// (todas las tareas, reparto, reasignación, mini-reporte por empleado).
import { Fragment, useCallback, useEffect, useState } from "react";
import { AlertTriangle, ClipboardCheck, Mail, SearchX } from "lucide-react";
import { apiGet, apiPatchJson, apiPostJson } from "../lib/api";
import { getUsuario } from "../lib/auth";
import { fechaCorta } from "../lib/categorias";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge, PuntoSemaforo } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { Campo, Select, Textarea } from "../components/ui/Field";
import { EmptyState } from "../components/ui/EmptyState";

interface Tarea {
  id: string;
  tipo: "RECORDAR_ENCUESTA" | "VERIFICAR_EMAIL";
  estado: "PENDIENTE" | "EN_GESTION" | "COMPLETADA" | "CANCELADA";
  resultado: string | null;
  notas: string | null;
  creadaEn: string;
  suprimido?: boolean;
  asignadoA: { id: string; nombre: string; activo: boolean } | null;
  caso: {
    id: string;
    numeroOrden: string;
    nombrePropietario: string;
    whatsapp: string;
    celular: string;
    emailPropietario: string | null;
    modelo: string;
    sucursal: string;
    fechaSalida: string | null;
    fechaProgramacion: string;
    tieneRqrAbierto: boolean;
    encuestaFordEstado: string;
    analisis: { semaforo: string | null }[];
  };
}

const TIPO_INFO: Record<string, { label: string; tono: "azul" | "amarillo"; icono: typeof Mail; ayuda: string }> = {
  RECORDAR_ENCUESTA: {
    label: "Recordar encuesta",
    tono: "azul",
    icono: ClipboardCheck,
    ayuda: "Contactá al cliente para recordarle que responda la encuesta de Ford que recibió por email.",
  },
  VERIFICAR_EMAIL: {
    label: "Verificar email",
    tono: "amarillo",
    icono: Mail,
    ayuda: "El email del cliente rebotó: verificá/corregí su dirección y avisale que le va a llegar la encuesta.",
  },
};

const RESULTADOS = [
  { value: "ENCUESTA_RESPONDIDA", label: "El cliente respondió la encuesta" },
  { value: "NO_CONTESTA", label: "No contesta / no se pudo contactar" },
  { value: "DATOS_ERRONEOS", label: "Datos de contacto erróneos" },
  { value: "RECHAZO", label: "El cliente no quiere participar" },
  { value: "OTRO", label: "Otro" },
];

export default function Refuerzos() {
  const esAdmin = getUsuario()?.rol === "ADMIN";
  const [tab, setTab] = useState<"mias" | "admin">("mias");

  return (
    <div className="space-y-4">
      {esAdmin && (
        <div className="flex gap-2 border-b border-gray-200">
          <TabBtn activo={tab === "mias"} onClick={() => setTab("mias")}>Mis casos a reforzar</TabBtn>
          <TabBtn activo={tab === "admin"} onClick={() => setTab("admin")}>Administración</TabBtn>
        </div>
      )}
      {tab === "mias" || !esAdmin ? <MisTareas /> : <AdminTareas />}
    </div>
  );
}

function TabBtn({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        activo ? "border-accent text-accent-dark" : "border-transparent text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

// ---------- Vista del empleado (CALIDAD): mis tareas ----------

function MisTareas() {
  const [tareas, setTareas] = useState<Tarea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const { data } = await apiGet<{ data: Tarea[] }>("/api/refuerzos/mias");
      setTareas(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar tus tareas.");
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function actualizar(id: string, body: Record<string, unknown>, ok: string) {
    setError(null); setMensaje(null);
    try {
      await apiPatchJson(`/api/refuerzos/${id}`, body);
      setMensaje(ok);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos actualizar la tarea.");
    }
  }

  if (!tareas) return <Card><p className="text-sm text-ink-muted">Cargando…</p></Card>;

  return (
    <div className="space-y-3">
      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}
      {tareas.length === 0 && (
        <EmptyState icono={ClipboardCheck} titulo="No tenés casos pendientes de refuerzo" descripcion="Cuando se importe una nueva tanda de encuestas de Ford, tus casos van a aparecer acá." />
      )}
      {tareas.map((t) => (
        <TareaCard key={t.id} tarea={t} onActualizar={actualizar} />
      ))}
    </div>
  );
}

function TareaCard({ tarea, onActualizar }: { tarea: Tarea; onActualizar: (id: string, body: Record<string, unknown>, ok: string) => void }) {
  const info = TIPO_INFO[tarea.tipo];
  const Icono = info.icono;
  const [completando, setCompletando] = useState(false);
  const [resultado, setResultado] = useState("");
  const [notas, setNotas] = useState("");
  const semaforo = tarea.caso.analisis[0]?.semaforo ?? null;
  const requiereNotas = resultado !== "" && resultado !== "ENCUESTA_RESPONDIDA";

  return (
    <Card padding="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge tono={info.tono}><Icono className="mr-1 inline h-3 w-3" aria-hidden="true" />{info.label}</Badge>
            <Badge tono={tarea.estado === "EN_GESTION" ? "amarillo" : "gris"}>{tarea.estado.replace("_", " ")}</Badge>
            {semaforo && <PuntoSemaforo semaforo={semaforo} soloIcono />}
            {tarea.caso.tieneRqrAbierto && <Badge tono="rojo">RQR abierto</Badge>}
            {tarea.suprimido && (
              <Badge tono="rojo" title="El cliente pidió no recibir WhatsApp nuestro. La encuesta Ford es de otro canal, pero tenelo presente.">
                no contactar por WhatsApp
              </Badge>
            )}
          </div>
          <h3 className="mt-1 font-display text-base font-semibold text-ink">{tarea.caso.nombrePropietario}</h3>
          <p className="text-xs text-ink-muted">{info.ayuda}</p>
        </div>
        <div className="text-right text-xs text-ink-muted">
          <div>Orden {tarea.caso.numeroOrden}</div>
          <div>Servicio {fechaCorta(tarea.caso.fechaSalida ?? tarea.caso.fechaProgramacion)}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Dato etiqueta="Teléfono" valor={tarea.caso.whatsapp || tarea.caso.celular || "—"} />
        <Dato etiqueta="Email" valor={tarea.caso.emailPropietario ?? "—"} resaltar={tarea.tipo === "VERIFICAR_EMAIL"} />
        <Dato etiqueta="Modelo" valor={tarea.caso.modelo} />
        <Dato etiqueta="Sucursal" valor={tarea.caso.sucursal} />
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
        {tarea.estado === "PENDIENTE" && (
          <button onClick={() => onActualizar(tarea.id, { estado: "EN_GESTION" }, "Tarea en gestión.")} className={claseBoton("secundario", "!py-1.5")}>
            Empezar gestión
          </button>
        )}
        {!completando ? (
          <button onClick={() => setCompletando(true)} className={claseBoton("primario", "!py-1.5")}>
            Completar
          </button>
        ) : (
          <div className="flex w-full flex-wrap items-end gap-2">
            <Campo etiqueta="Resultado">
              <Select value={resultado} onChange={(e) => setResultado(e.target.value)} className="w-64">
                <option value="">Elegí un resultado…</option>
                {RESULTADOS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
            </Campo>
            {requiereNotas && (
              <Campo etiqueta="Notas (obligatorias)">
                <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={1} className="w-80" placeholder="Qué pasó con el contacto…" />
              </Campo>
            )}
            <button
              disabled={!resultado || (requiereNotas && !notas.trim())}
              onClick={() => onActualizar(tarea.id, { estado: "COMPLETADA", resultado, notas: notas || null }, "Tarea completada.")}
              className={claseBoton("primario", "!py-1.5")}
            >
              Confirmar
            </button>
            <button onClick={() => setCompletando(false)} className={claseBoton("fantasma", "!py-1.5 border border-gray-300")}>Cancelar</button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Dato({ etiqueta, valor, resaltar }: { etiqueta: string; valor: string; resaltar?: boolean }) {
  return (
    <div>
      <span className="text-xs font-semibold uppercase text-ink-muted">{etiqueta}: </span>
      <span className={resaltar ? "font-semibold text-amber-700" : "text-ink"}>{valor}</span>
    </div>
  );
}

// ---------- Vista de administración (ADMIN) ----------

interface EmpleadoResumen {
  id: string; nombre: string; activo: boolean; participaEnRefuerzos: boolean;
  asignadas: number; completadas: number; abiertas: number; pctCompletadas: number;
  resultados: Record<string, number>;
}

function AdminTareas() {
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoResumen[]>([]);
  const [sinAsignar, setSinAsignar] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [filtroEmpleado, setFiltroEmpleado] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filtroEmpleado) params.set("asignadoAId", filtroEmpleado);
      if (filtroEstado) params.set("estado", filtroEstado);
      const [t, e] = await Promise.all([
        apiGet<{ data: Tarea[] }>(`/api/refuerzos?${params}`),
        apiGet<{ data: EmpleadoResumen[]; sinAsignar: number }>("/api/refuerzos/resumen-empleados"),
      ]);
      setTareas(t.data);
      setEmpleados(e.data);
      setSinAsignar(e.sinAsignar);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar las tareas.");
    }
  }, [filtroEmpleado, filtroEstado]);
  useEffect(() => { cargar(); }, [cargar]);

  async function reasignar(id: string, asignadoAId: string) {
    if (!asignadoAId) return;
    setError(null); setMensaje(null);
    try {
      const { message } = await apiPostJson<{ message: string }>(`/api/refuerzos/${id}/reasignar`, { asignadoAId });
      setMensaje(message);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos reasignar la tarea.");
    }
  }

  const inactivosConTareas = tareas.filter((t) => t.asignadoA && !t.asignadoA.activo);

  return (
    <div className="space-y-4">
      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}
      {sinAsignar > 0 && (
        <Alert tono="advertencia">
          <AlertTriangle className="mr-1 inline h-4 w-4" /> Hay {sinAsignar} tarea(s) SIN asignar (no había empleados elegibles al importar). Reasignalas abajo.
        </Alert>
      )}
      {inactivosConTareas.length > 0 && (
        <Alert tono="advertencia">
          <AlertTriangle className="mr-1 inline h-4 w-4" /> Hay {inactivosConTareas.length} tarea(s) asignadas a usuarios inactivos. Reasignalas.
        </Alert>
      )}

      {/* Mini-reporte por empleado */}
      <Card padding="p-0" className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
              <th className="px-3 py-2">Empleado</th>
              <th className="px-3 py-2 text-right">Abiertas</th>
              <th className="px-3 py-2 text-right">Asignadas</th>
              <th className="px-3 py-2 text-right">Completadas</th>
              <th className="px-3 py-2 text-right">% Compl.</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {empleados.map((e) => (
              <tr key={e.id} className="border-b border-gray-100">
                <td className="px-3 py-2 text-ink">{e.nombre}</td>
                <td className="px-3 py-2 text-right font-medium text-ink">{e.abiertas}</td>
                <td className="px-3 py-2 text-right text-ink-muted">{e.asignadas}</td>
                <td className="px-3 py-2 text-right text-ink-muted">{e.completadas}</td>
                <td className="px-3 py-2 text-right text-ink-muted">{e.pctCompletadas}%</td>
                <td className="px-3 py-2">
                  {!e.activo ? <Badge tono="rojo">Inactivo</Badge> : !e.participaEnRefuerzos ? <Badge tono="gris">No participa</Badge> : <Badge tono="verde">Activo</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Filtros + listado de todas las tareas */}
      <Card className="grid gap-3 sm:grid-cols-3">
        <Campo etiqueta="Empleado">
          <Select value={filtroEmpleado} onChange={(e) => setFiltroEmpleado(e.target.value)}>
            <option value="">Todos</option>
            {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </Select>
        </Campo>
        <Campo etiqueta="Estado">
          <Select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
            <option value="">Todos</option>
            {["PENDIENTE", "EN_GESTION", "COMPLETADA", "CANCELADA"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </Select>
        </Campo>
      </Card>

      <Card padding="p-0" className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Asignada a</th>
              <th className="px-3 py-2">Reasignar</th>
            </tr>
          </thead>
          <tbody>
            {tareas.map((t) => (
              <tr key={t.id} className="border-b border-gray-100">
                <td className="px-3 py-2 text-ink">{t.caso.nombrePropietario}<span className="ml-1 text-xs text-ink-muted">#{t.caso.numeroOrden}</span></td>
                <td className="px-3 py-2"><Badge tono={TIPO_INFO[t.tipo].tono}>{TIPO_INFO[t.tipo].label}</Badge></td>
                <td className="px-3 py-2 text-ink-muted">{t.estado.replace("_", " ")}</td>
                <td className="px-3 py-2">
                  {t.asignadoA ? (
                    <span className={!t.asignadoA.activo ? "text-red-700" : "text-ink"}>{t.asignadoA.nombre}{!t.asignadoA.activo && " (inactivo)"}</span>
                  ) : (
                    <Badge tono="amarillo">Sin asignar</Badge>
                  )}
                </td>
                <td className="px-3 py-2">
                  {t.estado !== "COMPLETADA" && t.estado !== "CANCELADA" && (
                    <Select defaultValue="" onChange={(e) => reasignar(t.id, e.target.value)} className="!py-1 text-xs">
                      <option value="">Mover a…</option>
                      {empleados.filter((e) => e.activo).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                    </Select>
                  )}
                </td>
              </tr>
            ))}
            {tareas.length === 0 && (
              <tr><td colSpan={5}><EmptyState icono={SearchX} titulo="No hay tareas con estos filtros" /></td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
