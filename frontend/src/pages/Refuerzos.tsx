// Seguimiento de la encuesta de Ford: tareas de refuerzo gestionadas por HUMANOS.
// MODELO DE POOL: las tareas NO tienen dueño. Cada empleado ve TODAS las tareas de
// su ÁREA + PROVINCIA (Yesica de Mendoza/Posventa ve todo Mendoza/Posventa). Cuando
// alguien la empieza/completa, queda registrado como "gestor" (para no llamar dos
// veces al mismo cliente). ADMIN además tiene la vista por pool.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ClipboardCheck, Info, Mail, SearchX, UserCheck } from "lucide-react";
import { apiGet, apiPatchJson, apiPostJson } from "../lib/api";
import { getUsuario } from "../lib/auth";
import { fechaCorta } from "../lib/categorias";
import { etiquetaArea, tonoArea } from "../lib/area";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge, PuntoSemaforo } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { Campo, Select, Textarea } from "../components/ui/Field";
import { EmptyState } from "../components/ui/EmptyState";

function provinciaLabel(s: string | null | undefined): string {
  return s && s.trim() ? s : "Todas";
}

interface Tarea {
  id: string;
  tipo: "RECORDAR_ENCUESTA" | "VERIFICAR_EMAIL";
  estado: "PENDIENTE" | "EN_GESTION" | "COMPLETADA" | "CANCELADA";
  resultado: string | null;
  notas: string | null;
  creadaEn: string;
  suprimido?: boolean;
  asignadoA: { id: string; nombre: string; activo: boolean } | null; // gestor (quién la trabaja)
  caso: {
    id: string;
    numeroOrden: string;
    nombrePropietario: string;
    whatsapp: string;
    celular: string;
    emailPropietario: string | null;
    modelo: string;
    area: string;
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
          <TabBtn activo={tab === "mias"} onClick={() => setTab("mias")}>Casos del equipo</TabBtn>
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

// ---------- Vista del empleado: el POOL de su área + provincia ----------

function MisTareas() {
  const yoId = getUsuario()?.id;
  const [tareas, setTareas] = useState<Tarea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const { data } = await apiGet<{ data: Tarea[] }>("/api/refuerzos/mias");
      setTareas(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar las tareas.");
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
      <Alert tono="info">
        <div className="flex items-start gap-1.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Estos son <strong>todos los casos de tu área y provincia</strong> (los ve todo el equipo). Cuando
            empezás a gestionar uno, queda a tu nombre para que <strong>nadie más llame al mismo cliente</strong>.
          </span>
        </div>
      </Alert>
      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}
      {tareas.length === 0 && (
        <EmptyState icono={ClipboardCheck} titulo="No hay casos pendientes de refuerzo" descripcion="Cuando se importe una nueva tanda de encuestas de Ford, los casos de tu área y provincia van a aparecer acá." />
      )}
      {tareas.map((t) => (
        <TareaCard key={t.id} tarea={t} yoId={yoId} onActualizar={actualizar} />
      ))}
    </div>
  );
}

function TareaCard({
  tarea,
  yoId,
  onActualizar,
}: {
  tarea: Tarea;
  yoId?: string;
  onActualizar: (id: string, body: Record<string, unknown>, ok: string) => void;
}) {
  const info = TIPO_INFO[tarea.tipo];
  const Icono = info.icono;
  const [completando, setCompletando] = useState(false);
  const [resultado, setResultado] = useState("");
  const [notas, setNotas] = useState("");
  const semaforo = tarea.caso.analisis[0]?.semaforo ?? null;
  const requiereNotas = resultado !== "" && resultado !== "ENCUESTA_RESPONDIDA";
  // ¿La está gestionando otra persona del equipo? (para avisar y evitar trabajo doble)
  const gestorOtro = tarea.estado === "EN_GESTION" && tarea.asignadoA && tarea.asignadoA.id !== yoId;

  return (
    <Card padding="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tono={info.tono}><Icono className="mr-1 inline h-3 w-3" aria-hidden="true" />{info.label}</Badge>
            <Badge tono={tarea.estado === "EN_GESTION" ? "amarillo" : "gris"}>{tarea.estado.replace("_", " ")}</Badge>
            {tarea.asignadoA && tarea.estado === "EN_GESTION" && (
              <Badge tono={gestorOtro ? "morado" : "verde"}>
                <UserCheck className="mr-1 inline h-3 w-3" aria-hidden="true" />
                {gestorOtro ? `La está gestionando ${tarea.asignadoA.nombre}` : "La estás gestionando vos"}
              </Badge>
            )}
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
          <button onClick={() => onActualizar(tarea.id, { estado: "EN_GESTION" }, "La tomaste: quedó a tu nombre.")} className={claseBoton("secundario", "!py-1.5")}>
            Tomar / empezar gestión
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

// ---------- Vista de administración (ADMIN): por POOL ----------

interface PoolResumen {
  area: string;
  sucursal: string;
  pendientes: number;
  enGestion: number;
  completadas: number;
  canceladas: number;
  integrantes: number;
  sinGente: boolean;
}
interface GestorResumen {
  id: string;
  nombre: string;
  completadas: number;
}

interface EstadoMail {
  notificaPorMail: boolean;
  configurado: boolean;
  casilla: string | null;
}
interface ResultadoNotificacion {
  vendedor: string;
  email: string;
  clientes: number;
  enviado: boolean;
  error: string | null;
}

function AdminTareas() {
  const [tareas, setTareas] = useState<Tarea[]>([]);
  // Aviso por correo a los vendedores (Volkswagen: no entran al sistema).
  const [estadoMail, setEstadoMail] = useState<EstadoMail | null>(null);
  const [notificando, setNotificando] = useState(false);
  const [resultadosMail, setResultadosMail] = useState<ResultadoNotificacion[] | null>(null);
  const [mensajeMail, setMensajeMail] = useState<string | null>(null);

  async function notificar() {
    setNotificando(true);
    setError(null);
    setResultadosMail(null);
    try {
      const r = await apiPostJson<{ message: string; resultados: ResultadoNotificacion[] }>(
        "/api/refuerzos/notificar",
        {}
      );
      setResultadosMail(r.resultados);
      setMensajeMail(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el aviso.");
    } finally {
      setNotificando(false);
    }
  }

  const [pools, setPools] = useState<PoolResumen[]>([]);
  const [porGestor, setPorGestor] = useState<GestorResumen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filtroEstado, setFiltroEstado] = useState("");

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filtroEstado) params.set("estado", filtroEstado);
      const [t, r, m] = await Promise.all([
        apiGet<{ data: Tarea[] }>(`/api/refuerzos?${params}`),
        apiGet<{ pools: PoolResumen[]; porGestor: GestorResumen[] }>("/api/refuerzos/resumen-empleados"),
        apiGet<EstadoMail>("/api/refuerzos/estado-mail").catch(() => null),
      ]);
      setTareas(t.data);
      setPools(r.pools);
      setPorGestor(r.porGestor);
      setEstadoMail(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar las tareas.");
    }
  }, [filtroEstado]);
  useEffect(() => { cargar(); }, [cargar]);

  const poolsSinGente = pools.filter((p) => p.sinGente && p.pendientes + p.enGestion > 0);

  return (
    <div className="space-y-4">
      {error && <Alert tono="error">{error}</Alert>}

      <Alert tono="info">
        <div className="flex items-start gap-1.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Los casos ya <strong>no se reparten por persona</strong>: cada empleado ve <strong>todos</strong> los
            casos de su <strong>área y provincia</strong> (pool compartido). Cuando alguien empieza a gestionar uno,
            queda a su nombre para que no lo trabaje otro.
          </span>
        </div>
      </Alert>

      {poolsSinGente.length > 0 && (
        <Alert tono="advertencia">
          <AlertTriangle className="mr-1 inline h-4 w-4" /> Hay {poolsSinGente.length} grupo(s){" "}
          <strong>sin ningún empleado</strong> — esos casos no los ve nadie. Creá o habilitá un usuario para:{" "}
          {poolsSinGente.map((p) => `${etiquetaArea(p.area)}/${provinciaLabel(p.sucursal)}`).join(", ")}.
        </Alert>
      )}

      {/* Aviso por correo. Solo en las marcas donde los vendedores NO entran al
          sistema: ahí el correo es la única forma de que se enteren. */}
      {estadoMail?.notificaPorMail && (
        <Card padding="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              <div className="font-semibold text-ink">Avisar a los vendedores por correo</div>
              <p className="mt-0.5 text-xs text-ink-muted">
                Le manda a cada vendedor un correo con el detalle de los clientes que tiene asignados y
                todavía están pendientes. Los vendedores no entran al sistema: este es el aviso.
                {estadoMail.casilla && <> Se envía desde <strong>{estadoMail.casilla}</strong>.</>}
              </p>
            </div>
            <button
              onClick={notificar}
              disabled={notificando || !estadoMail.configurado}
              className={claseBoton("primario", "!py-1.5")}
              title={
                estadoMail.configurado
                  ? "Enviar el aviso a cada vendedor con tareas pendientes"
                  : "Falta configurar la casilla de correo del sistema"
              }
            >
              <Mail className="h-4 w-4" /> {notificando ? "Enviando…" : "Avisar a los vendedores"}
            </button>
          </div>

          {!estadoMail.configurado && (
            <div className="mt-3">
              <Alert tono="advertencia">
                Todavía no hay una casilla de correo configurada, así que el aviso no se puede enviar.
                Hay que cargar el usuario y la contraseña de aplicación en el archivo de entorno del sistema.
              </Alert>
            </div>
          )}

          {/* Resultado por vendedor: quién recibió y quién no. Un fallo con uno
              no impide que los demás reciban, así que hay que poder verlo. */}
          {mensajeMail && (
            <div className="mt-3">
              <Alert tono="exito">{mensajeMail}</Alert>
            </div>
          )}

          {resultadosMail && resultadosMail.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
                    <th className="px-3 py-1.5">Vendedor</th>
                    <th className="px-3 py-1.5">Correo</th>
                    <th className="px-3 py-1.5 text-center">Clientes</th>
                    <th className="px-3 py-1.5">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {resultadosMail.map((r) => (
                    <tr key={r.email} className="border-b border-gray-100">
                      <td className="px-3 py-1.5 text-ink">{r.vendedor}</td>
                      <td className="px-3 py-1.5 text-ink-muted">{r.email}</td>
                      <td className="px-3 py-1.5 text-center text-ink-muted">{r.clientes}</td>
                      <td className="px-3 py-1.5">
                        {r.enviado ? (
                          <span className="text-xs font-medium text-green-700">Enviado</span>
                        ) : (
                          <span className="text-xs text-red-700" title={r.error ?? undefined}>
                            {r.error ?? "Falló"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Estado de cada pool (área + provincia) */}
      <Card padding="p-0" className="overflow-x-auto">
        <div className="border-b bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Estado por grupo (área + provincia)
        </div>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
              <th className="px-3 py-2">Área</th>
              <th className="px-3 py-2">Provincia</th>
              <th className="px-3 py-2 text-right">Pendientes</th>
              <th className="px-3 py-2 text-right">En gestión</th>
              <th className="px-3 py-2 text-right">Completadas</th>
              <th className="px-3 py-2 text-right">Empleados</th>
            </tr>
          </thead>
          <tbody>
            {pools.map((p) => (
              <tr key={`${p.area}|${p.sucursal}`} className="border-b border-gray-100">
                <td className="px-3 py-2"><Badge tono={tonoArea(p.area)} className="cursor-default">{etiquetaArea(p.area)}</Badge></td>
                <td className="px-3 py-2 text-ink-muted">{provinciaLabel(p.sucursal)}</td>
                <td className="px-3 py-2 text-right font-medium text-ink">{p.pendientes}</td>
                <td className="px-3 py-2 text-right text-ink-muted">{p.enGestion}</td>
                <td className="px-3 py-2 text-right text-green-700">{p.completadas}</td>
                <td className="px-3 py-2 text-right">
                  {p.sinGente ? <Badge tono="rojo">nadie</Badge> : <span className="text-ink-muted">{p.integrantes}</span>}
                </td>
              </tr>
            ))}
            {pools.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-ink-muted">Todavía no hay tareas de refuerzo.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Productividad: completadas por persona (gestor) */}
      {porGestor.length > 0 && (
        <Card padding="p-0" className="overflow-x-auto">
          <div className="border-b bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Completadas por persona
          </div>
          <table className="min-w-full text-sm">
            <tbody>
              {porGestor.map((g) => (
                <tr key={g.id} className="border-b border-gray-100">
                  <td className="px-3 py-2 text-ink">{g.nombre}</td>
                  <td className="px-3 py-2 text-right font-medium text-green-700">{g.completadas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Filtros + listado de todas las tareas */}
      <Card>
        <Campo etiqueta="Estado">
          <Select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="max-w-xs">
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
              <th className="px-3 py-2">Área</th>
              <th className="px-3 py-2">Provincia</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Gestionado por</th>
            </tr>
          </thead>
          <tbody>
            {tareas.map((t) => (
              <tr key={t.id} className="border-b border-gray-100">
                <td className="px-3 py-2 text-ink">{t.caso.nombrePropietario}<span className="ml-1 text-xs text-ink-muted">#{t.caso.numeroOrden}</span></td>
                <td className="px-3 py-2"><Badge tono={TIPO_INFO[t.tipo].tono}>{TIPO_INFO[t.tipo].label}</Badge></td>
                <td className="px-3 py-2"><Badge tono={tonoArea(t.caso.area)} className="cursor-default">{etiquetaArea(t.caso.area)}</Badge></td>
                <td className="px-3 py-2 text-ink-muted">{provinciaLabel(t.caso.sucursal)}</td>
                <td className="px-3 py-2 text-ink-muted">{t.estado.replace("_", " ")}</td>
                <td className="px-3 py-2">
                  {t.asignadoA ? (
                    <span className={!t.asignadoA.activo ? "text-red-700" : "text-ink"}>{t.asignadoA.nombre}{!t.asignadoA.activo && " (inactivo)"}</span>
                  ) : (
                    <span className="text-xs text-ink-muted">— en el pool</span>
                  )}
                </td>
              </tr>
            ))}
            {tareas.length === 0 && (
              <tr><td colSpan={6}><EmptyState icono={SearchX} titulo="No hay tareas con estos filtros" /></td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
