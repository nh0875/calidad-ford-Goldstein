// Encuestas de fábrica de Volkswagen.
//
// Fábrica le manda la encuesta al cliente por mail y publica un Excel con los
// que todavía no la contestaron. Estos clientes NO se pueden contactar desde el
// sistema —el archivo no trae teléfono— así que el recordatorio va al VENDEDOR
// que hizo la entrega, para que los llame él.
//
// Por eso esta pantalla se organiza por vendedor y no por cliente: la unidad de
// trabajo es "a quién le mando el mail y con qué lista adentro".
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Mail, MailCheck, Pencil, Plus, Trash2, UploadCloud, UserPlus } from "lucide-react";
import { apiDelete, apiGet, apiPatchJson, apiPostForm, apiPostJson } from "../lib/api";
import { getMarca } from "../lib/marca";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { Campo, Input, Select } from "../components/ui/Field";
import { EmptyState } from "../components/ui/EmptyState";
import { SkeletonBlock } from "../components/ui/Skeleton";
import { SelectorSucursal } from "../components/ui/SelectorSucursal";

// Los tres estados por los que pasa un cliente. El orden del array es el orden
// del circuito, y de ahí sale también el orden de la lista en pantalla: primero
// lo que falta hacer, último lo que ya está cerrado.
//
// El valor guardado es RESPONDIO (así se llama en la base desde el principio) y
// en pantalla se lee "Respondió". Renombrarlo no aportaría nada y obligaría a
// migrar datos que ya están.
const ESTADOS = ["PENDIENTE", "AVISADO", "RESPONDIO"] as const;
type EstadoCliente = (typeof ESTADOS)[number];

const ETIQUETA_ESTADO: Record<EstadoCliente, string> = {
  PENDIENTE: "Pendiente",
  AVISADO: "Avisado",
  RESPONDIO: "Respondió",
};

// El estado se cambia desde un desplegable, pero se sigue leyendo de un vistazo
// por el color, como cuando era una etiqueta fija. En una lista de cientos de
// filas el color es lo que deja barrer la pantalla sin leer palabra por palabra.
const CLASE_ESTADO: Record<EstadoCliente, string> = {
  PENDIENTE: "bg-yellow-50 text-yellow-900 border-yellow-200 hover:bg-yellow-100",
  AVISADO: "bg-accent-light text-accent-dark border-accent/30 hover:bg-accent-light/70",
  RESPONDIO: "bg-green-50 text-green-900 border-green-200 hover:bg-green-100",
};

/** Un número del resumen, con su etiqueta al lado. */
function Dato({ valor, etiqueta, clase }: { valor: number; etiqueta: string; clase: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 rounded-full px-3 py-1 ${clase}`}>
      <span className="text-sm font-bold tabular-nums">{valor}</span>
      <span className="text-xs">{etiqueta}</span>
    </span>
  );
}

/**
 * El estado del cliente, como pastilla que además se puede cambiar.
 *
 * NO usa el <Select> del sistema a propósito. El desplegable nativo de Windows
 * dibuja su propia flecha, con su propio gris y su propia tipografía, y al lado
 * de una celda de tabla se ve como un parche pegado. Con appearance-none se
 * apaga ese dibujo y se pone una flecha nuestra, que hereda el color del estado.
 *
 * El <select> real sigue estando abajo, invisible pero funcional: así se conserva
 * el teclado, el lector de pantalla y el desplegable del sistema operativo, que es
 * lo que la gente ya sabe usar. Es maquillaje, no un control inventado de cero.
 */
function SelectorEstado({
  valor,
  onCambiar,
  deshabilitado,
  titulo,
}: {
  valor: EstadoCliente;
  onCambiar: (e: EstadoCliente) => void;
  deshabilitado?: boolean;
  titulo?: string;
}) {
  // Ancho FIJO en el contenedor, no en el select: las tres etiquetas miden
  // distinto ("Pendiente" / "Avisado" / "Respondió") y sin esto cada pastilla
  // tendría su propio ancho, con la columna quedando dentada al recorrerla.
  return (
    <div className="relative inline-flex w-32">
      <select
        value={valor}
        disabled={deshabilitado}
        title={titulo}
        onChange={(e) => onCambiar(e.target.value as EstadoCliente)}
        className={`w-full cursor-pointer appearance-none rounded-full border py-1 pl-3 pr-7 font-sans text-xs font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50 ${CLASE_ESTADO[valor]}`}
      >
        {ESTADOS.map((e) => (
          <option key={e} value={e}>
            {ETIQUETA_ESTADO[e]}
          </option>
        ))}
      </select>
      {/* pointer-events-none: la flecha es decorativa, el clic tiene que llegar
          al select que está abajo. */}
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-60" />
    </div>
  );
}

interface Pendiente {
  id: string;
  chasis: string;
  dominio: string | null;
  nombreCliente: string;
  email: string;
  canalVentas: string | null;
  area: string | null;
  fechaEntrega: string | null;
  estado: EstadoCliente;
  observacionesFabrica: string[];
  esManual?: boolean;
  avisadoEn?: string | null;
  respondioEn?: string | null;
  detectadaEn?: string | null;
}

interface Vendedor {
  id: string;
  codigo: string;
  nombre: string | null;
  email: string | null;
  sucursal: string;
  activo: boolean;
  ultimoAvisoEn: string | null;
  pendientes: Pendiente[];
}

interface Resumen {
  totalPendientes: number;
  vendedoresConPendientes: number;
  sinCorreo: number;
  totalClientes: number;
  totalAvisados: number;
  totalRespondidos: number;
  totalManuales: number;
  totalVendedores: number;
}

interface VistaPrevia {
  fileToken: string;
  filename: string;
  // Todos opcionales a propósito: el formato interno no los llena, y la pantalla
  // NO se puede caer porque falte uno (ya pasó: pantallazo blanco al cargar).
  hojas?: Array<{ nombre: string; sucursal: string; codigoSucursal: string | null; clientes: number; filasVacias: number }>;
  totalClientes: number;
  seDarianPorRespondidos: number;
  vendedores?: Array<{ codigo: string; nombre: string | null; sucursal: string; clientes: number }>;
  vendedoresSinNombre?: Array<{ codigo: string; sucursal: string; filas: number }>;
  rechazadas?: Array<{ hoja: string; numeroFilaExcel: number; motivo: string }>;
  observadasPorFabrica?: Array<{ hoja: string; fila: number; cliente: string; observaciones: string[] }>;
  avisos?: string[];
  /** "INTERNO" cuando el archivo es el export de la concesionaria. */
  formato?: "FABRICA" | "INTERNO";
  /** Solo en el interno: vendedores que vinieron por nombre y hay que asignar. */
  vendedoresSinAsignar?: Array<{ nombre: string; filas: number }>;
  vendedoresDisponibles?: Array<{ codigo: string; nombre: string | null; sucursal: string }>;
}

interface EstadoMail {
  notificaPorMail: boolean;
  configurado: boolean;
  casilla: string | null;
}

interface ResultadoAviso {
  codigo: string;
  vendedor: string;
  email: string | null;
  pendientes: number;
  enviado: boolean;
  error: string | null;
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const f = new Date(iso);
  return `${String(f.getDate()).padStart(2, "0")}/${String(f.getMonth() + 1).padStart(2, "0")}/${f.getFullYear()}`;
}

export default function EncuestasFabrica() {
  const marca = getMarca();
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  // Casilla del sistema. Sin esto no sale ningún correo, así que se avisa ANTES
  // de que alguien apriete el botón y le vuelvan 18 errores iguales.
  const [estadoMail, setEstadoMail] = useState<EstadoMail | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([
        // Se piden tambien los respondidos: si no, el cliente desaparecia de la
        // pantalla apenas contestaba y no habia forma de hacerle seguimiento.
        apiGet<{ data: Vendedor[]; resumen: Resumen }>("/api/encuesta-vw?incluirRespondidos=true"),
        apiGet<EstadoMail>("/api/encuesta-vw/estado-mail").catch(() => null),
      ]);
      setVendedores(r.data);
      setResumen(r.resumen);
      setEstadoMail(m);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar las encuestas pendientes.");
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  // ---- Carga del Excel -----------------------------------------------------
  const [previa, setPrevia] = useState<VistaPrevia | null>(null);
  // Formato interno: nombre del vendedor tal como viene -> código elegido.
  const [mapeoVendedores, setMapeoVendedores] = useState<Record<string, string>>({});
  const [subiendo, setSubiendo] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  async function subirArchivo(archivo: File) {
    setSubiendo(true);
    setError(null);
    setMensaje(null);
    setPrevia(null);
    try {
      const form = new FormData();
      form.append("archivo", archivo);
      setPrevia(await apiPostForm<VistaPrevia>("/api/encuesta-vw/preview", form));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos leer el archivo.");
    } finally {
      setSubiendo(false);
    }
  }

  async function confirmar() {
    if (!previa) return;
    setConfirmando(true);
    setError(null);
    try {
      const r = await apiPostJson<{ message: string }>("/api/encuesta-vw/confirm", {
        fileToken: previa.fileToken,
        // Solo viaja en el formato interno: lo que la persona acaba de asignar.
        // El backend lo guarda como alias, así la próxima carga ya los reconoce.
        ...(Object.keys(mapeoVendedores).length > 0 ? { mapeoVendedores } : {}),
      });
      setMensaje(r.message);
      setPrevia(null);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos confirmar la carga.");
    } finally {
      setConfirmando(false);
    }
  }

  // ---- Aviso por correo ----------------------------------------------------
  const [avisando, setAvisando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoAviso[] | null>(null);

  async function avisar(codigos?: string[]) {
    setAvisando(true);
    setError(null);
    setResultados(null);
    try {
      const r = await apiPostJson<{ message: string; resultados: ResultadoAviso[] }>(
        "/api/encuesta-vw/notificar",
        codigos ? { codigos } : {}
      );
      setResultados(r.resultados);
      setMensaje(r.message);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el aviso.");
    } finally {
      setAvisando(false);
    }
  }

  // ---- Edición del vendedor ------------------------------------------------
  const [editando, setEditando] = useState<string | null>(null);
  const [formNombre, setFormNombre] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [guardando, setGuardando] = useState(false);

  function abrirEdicion(v: Vendedor) {
    setEditando(v.id);
    setFormNombre(v.nombre ?? "");
    setFormEmail(v.email ?? "");
  }

  async function guardarVendedor(id: string) {
    setGuardando(true);
    setError(null);
    try {
      const r = await apiPatchJson<{ message: string }>(`/api/encuesta-vw/vendedores/${id}`, {
        nombre: formNombre.trim() || null,
        email: formEmail.trim() || null,
      });
      setMensaje(r.message);
      setEditando(null);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar el vendedor.");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarVendedor(v: Vendedor) {
    const ok = window.confirm(
      `¿Eliminar a ${v.nombre || v.codigo}?

` +
        `Solo se puede si no tiene encuestas asociadas. Si las tiene, el sistema te lo ` +
        `va a decir y vas a poder desactivarlo en vez de borrarlo.`
    );
    if (!ok) return;
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      const r = await apiDelete<{ message: string }>(`/api/encuesta-vw/vendedores/${v.id}`);
      setMensaje(r.message);
      await cargar();
    } catch (err) {
      // El 409 de "tiene encuestas asociadas" trae la explicación y qué hacer:
      // se muestra tal cual, no se traduce a un "no se pudo" genérico.
      setError(err instanceof Error ? err.message : "No pudimos eliminar el vendedor.");
    } finally {
      setGuardando(false);
    }
  }

  // ---- Clientes cargados ---------------------------------------------------
  //
  // Hasta ahora los clientes solo se veian abriendo vendedor por vendedor, y los
  // que ya habian contestado directamente no se pedian: el seguimiento se cortaba
  // justo cuando el caso se cerraba. Esta lista los junta a todos, con buscador.
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<"TODOS" | EstadoCliente>("TODOS");

  const clientes = useMemo(() => {
    const filas = vendedores.flatMap((v) =>
      v.pendientes.map((p) => ({
        ...p,
        vendedorNombre: v.nombre || v.codigo,
        vendedorCodigo: v.codigo,
        sucursal: v.sucursal,
      }))
    );
    const q = busquedaCliente.trim().toLowerCase();
    return filas
      .filter((f) => filtroEstado === "TODOS" || f.estado === filtroEstado)
      .filter(
        (f) =>
          q === "" ||
          f.nombreCliente.toLowerCase().includes(q) ||
          f.chasis.toLowerCase().includes(q) ||
          (f.dominio ?? "").toLowerCase().includes(q) ||
          (f.email ?? "").toLowerCase().includes(q) ||
          f.vendedorNombre.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        // Por avance del circuito: primero lo que falta hacer (pendientes),
        // después lo que está esperando respuesta (avisados) y al final lo
        // cerrado. Dentro de cada grupo, el mas viejo arriba, que es el que mas
        // espero.
        const orden = ESTADOS.indexOf(a.estado) - ESTADOS.indexOf(b.estado);
        if (orden !== 0) return orden;
        return (a.fechaEntrega ?? "").localeCompare(b.fechaEntrega ?? "");
      });
  }, [vendedores, busquedaCliente, filtroEstado]);

  // Cambio de estado a mano, y la nota que lo acompaña.
  //
  // Sin esto el estado solo se movía solo: la carga del Excel cerraba lo que ya
  // no venía y el aviso pasaba los pendientes a avisados. Ninguno de los dos se
  // entera de lo que pasa por teléfono, que es donde el vendedor se entera de
  // verdad si el cliente contestó y qué puso.
  async function cambiarCliente(
    id: string,
    cambios: { estado?: EstadoCliente }
  ) {
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      await apiPatchJson(`/api/encuesta-vw/clientes/${id}`, cambios);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cambiar el estado del cliente.");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarCliente(c: { id: string; nombreCliente: string; esManual?: boolean }) {
    const ok = window.confirm(
      `¿Sacar a ${c.nombreCliente} de la lista?

` +
        (c.esManual
          ? "Se cargó a mano, así que no va a volver."
          : "OJO: vino del Excel de fábrica. Si todavía figura ahí, la próxima carga lo vuelve a traer.")
    );
    if (!ok) return;
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      const r = await apiDelete<{ message: string }>(`/api/encuesta-vw/clientes/${c.id}`);
      setMensaje(r.message);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos eliminar el cliente.");
    } finally {
      setGuardando(false);
    }
  }

  // ---- Alta manual de una encuesta pendiente --------------------------------
  const [altaManual, setAltaManual] = useState(false);
  const [manual, setManual] = useState({
    chasis: "",
    dominio: "",
    nombreCliente: "",
    email: "",
    codigoVendedor: "",
    fechaEntrega: "",
  });

  async function crearEncuestaManual() {
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      const r = await apiPostJson<{ message: string }>("/api/encuesta-vw/manual", manual);
      setMensaje(r.message);
      setAltaManual(false);
      setManual({ chasis: "", dominio: "", nombreCliente: "", email: "", codigoVendedor: "", fechaEntrega: "" });
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos agregar el caso.");
    } finally {
      setGuardando(false);
    }
  }

  // ---- Alta manual ---------------------------------------------------------
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({ codigo: "", sucursal: "", nombre: "", email: "" });

  async function crearVendedor() {
    setGuardando(true);
    setError(null);
    try {
      const r = await apiPostJson<{ message: string }>("/api/encuesta-vw/vendedores", nuevo);
      setMensaje(r.message);
      setCreando(false);
      setNuevo({ codigo: "", sucursal: "", nombre: "", email: "" });
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear el vendedor.");
    } finally {
      setGuardando(false);
    }
  }

  const conPendientes = useMemo(
    () => vendedores.filter((v) => v.pendientes.some((p) => p.estado === "PENDIENTE")),
    [vendedores]
  );
  const sinCorreo = conPendientes.filter((v) => !v.email);

  if (!marca.modulos.encuestaFabrica) {
    return <Alert tono="info">Esta pantalla es de {marca.nombre}. En esta marca no aplica.</Alert>;
  }

  return (
    <div className="space-y-4">
      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}

      {/* Resumen + acciones */}
      <Card padding="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-navy">
              Encuestas de fábrica sin responder
            </h2>
            {/* Cuatro numeros sueltos en vez de un parrafo corrido. Antes decia
                "0 sin avisar entre 0 vendedor(es), 65 ya avisado(s)..." de un
                tiron: habia que LEERLO entero para sacar un dato que se responde
                de un vistazo. Ademas, con todo avisado quedaban frases raras
                ("entre 0 vendedores") que sonaban a error del sistema. */}
            {resumen ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Dato valor={resumen.totalPendientes} etiqueta="sin avisar" clase="bg-yellow-50 text-yellow-900" />
                <Dato valor={resumen.totalAvisados} etiqueta="esperando respuesta" clase="bg-accent-light text-accent-dark" />
                <Dato valor={resumen.totalRespondidos} etiqueta="respondieron" clase="bg-green-50 text-green-900" />
                <Dato valor={resumen.totalClientes} etiqueta="en total" clase="bg-gray-100 text-ink-muted" />
              </div>
            ) : (
              <p className="mt-1 text-sm text-ink-muted">Cargando…</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${claseBoton("secundario", "!py-1.5")} cursor-pointer`}>
              <UploadCloud className="h-4 w-4" />
              {subiendo ? "Leyendo…" : "Cargar Excel de fábrica"}
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={subiendo}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) subirArchivo(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              onClick={() => avisar()}
              disabled={avisando || conPendientes.length === 0 || estadoMail?.configurado === false}
              className={claseBoton("primario", "!py-1.5")}
              title={
                estadoMail?.configurado === false
                  ? "Falta configurar la casilla de correo del sistema"
                  : "Mandarle a cada vendedor la lista de sus clientes pendientes"
              }
            >
              <Mail className="h-4 w-4" /> {avisando ? "Enviando…" : "Avisar a los vendedores"}
            </button>
          </div>
        </div>

        {estadoMail?.configurado === false && (
          <div className="mt-3">
            <Alert tono="advertencia">
              El sistema todavía no tiene una casilla de correo configurada, así que no puede avisarle a nadie. Hay que
              cargar MAIL_USUARIO y MAIL_PASSWORD (una contraseña de aplicación de Google) en el archivo de entorno del
              servidor.
            </Alert>
          </div>
        )}

        {sinCorreo.length > 0 && (
          <div className="mt-3"><Alert tono="advertencia">
            {sinCorreo.length === 1
              ? `Al vendedor ${sinCorreo[0].nombre || sinCorreo[0].codigo} le falta el correo, así que no se le puede avisar.`
              : `A ${sinCorreo.length} vendedores con clientes pendientes les falta el correo, así que no se les puede avisar.`}{" "}
            Cargáselo con el lápiz de su fila.
          </Alert></div>
        )}
      </Card>

      {/* Vista previa de la carga: se muestra ANTES de tocar la base */}
      {previa && (
        <Card padding="p-5">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy">
            Antes de confirmar — {previa.filename}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-gray-200 p-3">
              <div className="text-2xl font-bold text-navy">{previa.totalClientes}</div>
              <div className="text-xs text-ink-muted">clientes en el archivo</div>
            </div>
            <div className="rounded-md border border-gray-200 p-3">
              <div className="text-2xl font-bold text-navy">{(previa.vendedores ?? []).length}</div>
              <div className="text-xs text-ink-muted">vendedores distintos</div>
            </div>
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
              <div className="text-2xl font-bold text-amber-700">{previa.seDarianPorRespondidos}</div>
              <div className="text-xs text-amber-800">
                se van a dar por respondidos (estaban pendientes y ya no vienen en el archivo)
              </div>
            </div>
          </div>

          <div className="mt-3 text-sm text-ink-muted">
            {(previa.hojas ?? []).map((h) => (
              <div key={h.nombre}>
                <strong>{h.sucursal}</strong> ({h.codigoSucursal ?? "sin código"}): {h.clientes} cliente(s)
                {h.filasVacias > 0 && `, ${h.filasVacias} fila(s) en blanco salteadas`}
              </div>
            ))}
          </div>

          {(previa.vendedoresSinNombre ?? []).length > 0 && (
            <div className="mt-3"><Alert tono="advertencia">
              Hay {(previa.vendedoresSinNombre ?? []).length} código(s) de vendedor que no figuran en la hoja de nombres:{" "}
              {(previa.vendedoresSinNombre ?? []).map((v) => `${v.codigo} (${v.filas})`).join(", ")}. Se cargan igual y les
              podés poner nombre y correo desde la lista de abajo.
            </Alert></div>
          )}
          {(previa.rechazadas ?? []).length > 0 && (
            <div className="mt-3"><Alert tono="error">
              {(previa.rechazadas ?? []).length} fila(s) no se van a importar:{" "}
              {(previa.rechazadas ?? []).slice(0, 5).map((r) => `${r.hoja} fila ${r.numeroFilaExcel} (${r.motivo})`).join("; ")}
              {(previa.rechazadas ?? []).length > 5 && ` y ${(previa.rechazadas ?? []).length - 5} más`}.
            </Alert></div>
          )}
          {(previa.observadasPorFabrica ?? []).length > 0 && (
            <div className="mt-3"><Alert tono="advertencia">
              Fábrica observó {(previa.observadasPorFabrica ?? []).length} fila(s) (mail inválido, chasis repetido u otro). Se
              importan igual, pero conviene revisarlas.
            </Alert></div>
          )}
          {(previa.avisos ?? []).map((a, i) => (
            <div key={i} className="mt-3">
              <Alert tono="advertencia">{a}</Alert>
            </div>
          ))}

          {/* Formato interno: el archivo trae el vendedor por NOMBRE. Lo que no se
              pudo resolver solo se asigna acá, una vez, y queda guardado. */}
          {previa.formato === "INTERNO" && (previa.vendedoresSinAsignar?.length ?? 0) > 0 && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <h4 className="text-sm font-semibold text-amber-900">
                Falta decir quiénes son estos vendedores
              </h4>
              <p className="mt-1 text-sm text-amber-900">
                Este archivo trae el nombre del vendedor, no su código, y el sistema necesita el
                código para saber a qué sucursal pertenece cada cliente y a quién avisarle. Asignalos
                una vez: la próxima carga ya los va a reconocer solos.
              </p>
              <div className="mt-3 space-y-2">
                {previa.vendedoresSinAsignar?.map((v) => (
                  <div key={v.nombre} className="flex flex-wrap items-center gap-3">
                    <span className="min-w-[16rem] text-sm font-medium text-ink">
                      {v.nombre}{" "}
                      <span className="font-normal text-ink-muted">({v.filas} cliente(s))</span>
                    </span>
                    <Select
                      className="!w-80"
                      value={mapeoVendedores[v.nombre] ?? ""}
                      onChange={(e) =>
                        setMapeoVendedores((prev) => ({ ...prev, [v.nombre]: e.target.value }))
                      }
                    >
                      <option value="">Elegí a qué vendedor corresponde…</option>
                      {previa.vendedoresDisponibles?.map((d) => (
                        <option key={d.codigo} value={d.codigo}>
                          {d.nombre ? `${d.nombre} (${d.codigo})` : d.codigo} — {d.sucursal}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={confirmar}
              disabled={
                confirmando ||
                // No se deja confirmar con vendedores sin asignar: sus filas se
                // rechazarían en silencio y esos clientes no los llamaría nadie.
                (previa.formato === "INTERNO" &&
                  (previa.vendedoresSinAsignar ?? []).some((v) => !mapeoVendedores[v.nombre]))
              }
              className={claseBoton("primario")}
            >
              {confirmando ? "Cargando…" : "Confirmar la carga"}
            </button>
            <button onClick={() => setPrevia(null)} disabled={confirmando} className={claseBoton("secundario")}>
              Cancelar
            </button>
          </div>
        </Card>
      )}

      {/* Resultado del envío de correos */}
      {resultados && resultados.length > 0 && (
        <Card padding="p-5">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy">Resultado del aviso</h3>
          <div className="mt-2 space-y-1 text-sm">
            {resultados.map((r) => (
              <div key={r.codigo} className="flex flex-wrap items-center gap-2">
                <Badge tono={r.enviado ? "verde" : "rojo"}>{r.enviado ? "enviado" : "no salió"}</Badge>
                <span className="font-medium">{r.vendedor}</span>
                <span className="text-ink-muted">
                  {r.email || "sin correo"} — {r.pendientes} cliente(s)
                </span>
                {r.error && <span className="text-rojo">{r.error}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Clientes cargados */}
      <Card padding="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy">
            Clientes cargados{resumen ? ` (${clientes.length} de ${resumen.totalClientes})` : ""}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={busquedaCliente}
              onChange={(e) => setBusquedaCliente(e.target.value)}
              placeholder="Buscar por cliente, chasis, dominio, correo o vendedor"
              className="!w-72"
            />
            <Select
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value as "TODOS" | EstadoCliente)}
              className="!w-44"
            >
              <option value="TODOS">Todos</option>
              <option value="PENDIENTE">Solo pendientes</option>
              <option value="AVISADO">Solo avisados</option>
              <option value="RESPONDIO">Solo respondidos</option>
            </Select>
          </div>
        </div>

        {clientes.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-muted">
            {busquedaCliente || filtroEstado !== "TODOS"
              ? "Ningún cliente coincide con lo que buscaste."
              : "Todavía no hay clientes cargados. Subí el Excel de fábrica o agregá uno a mano."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                {/* SIETE columnas, no diez. Antes cada dato tenía la suya y no
                    entraban: el nombre del cliente partía en tres renglones (de ahí
                    que la lista se viera estirada) y la última columna quedaba
                    cortada contra el borde, con el botón de eliminar a medias.
                    Los pares que siempre se leen juntos —cliente y su correo,
                    vendedor y su sucursal— van apilados en una sola celda: ocupan
                    DOS renglones fijos en vez de tres impredecibles. */}
                <tr className="border-b border-gray-200 bg-gray-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  <th className="px-4 py-2.5">Cliente</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Chasis / Dominio</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Vendedor</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Entrega</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Estado</th>
                  <th className="whitespace-nowrap px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => (
                  <Fragment key={c.id}>
                    <tr className="border-b border-gray-100 transition-colors duration-150 hover:bg-accent-light/20">
                      {/* max-w + truncate: un nombre largo se corta con puntos
                          suspensivos en vez de partirse en tres renglones y
                          estirar toda la fila. El completo queda en el title. */}
                      <td className="max-w-[15rem] px-4 py-2.5">
                        <div className="truncate font-medium text-ink" title={c.nombreCliente}>
                          {c.nombreCliente}
                          {/* El origen solo se marca cuando es a mano. "Excel de
                              fábrica" es el caso normal y repetirlo en las 65
                              filas era una columna entera de ruido. */}
                          {c.esManual && (
                            <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-gray-700">
                              A MANO
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-ink-muted" title={c.email || undefined}>
                          {c.email || "sin correo"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <div className="font-mono text-[11px] text-ink-muted">{c.chasis}</div>
                        <div className="font-mono text-[11px] font-semibold text-ink">{c.dominio || "—"}</div>
                      </td>
                      <td className="max-w-[11rem] px-3 py-2.5">
                        <div className="truncate text-ink" title={c.vendedorNombre}>
                          {c.vendedorNombre}
                        </div>
                        <div className="truncate text-xs text-ink-muted">{c.sucursal}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">
                        {c.fechaEntrega ? fechaCorta(c.fechaEntrega) : "—"}
                      </td>
                      {/* El estado se cambia acá mismo, sin abrir nada: es lo que
                          más se toca, y esconderlo detrás de un botón sumaría un
                          clic a cada corrección. */}
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <SelectorEstado
                          valor={c.estado}
                          deshabilitado={guardando}
                          onCambiar={(estado) => cambiarCliente(c.id, { estado })}
                          titulo={
                            c.avisadoEn
                              ? `Se le avisó al vendedor el ${fechaCorta(c.avisadoEn)}`
                              : "Todavía no se le avisó al vendedor"
                          }
                        />
                      </td>
                      {/* Botón de verdad, no texto suelto: antes era una palabra
                          contra el borde de la fila, y "Eliminar" en rojo pelado
                          se leía como un error del sistema y no como una acción. */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => eliminarCliente(c)}
                            disabled={guardando}
                            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-all duration-150 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                            title="Sacar este cliente de la lista"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Alta manual de un pendiente */}
      <Card padding="p-0">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy">
            Agregar un caso a mano
          </h3>
          <button onClick={() => setAltaManual((v) => !v)} className={claseBoton("secundario", "!py-1.5")}>
            <Plus className="h-4 w-4" /> {altaManual ? "Cancelar" : "Agregar caso"}
          </button>
        </div>

        {altaManual && (
          <div className="grid gap-3 bg-gray-50 p-5 sm:grid-cols-3">
            <Campo etiqueta="Chasis" hint="Identifica la unidad y no se repite">
              <Input
                value={manual.chasis}
                onChange={(e) => setManual({ ...manual, chasis: e.target.value })}
                placeholder="9BWBH6BF7T4116921"
              />
            </Campo>
            <Campo etiqueta="Dominio">
              <Input
                value={manual.dominio}
                onChange={(e) => setManual({ ...manual, dominio: e.target.value })}
                placeholder="AI536KD"
              />
            </Campo>
            <Campo etiqueta="Vendedor">
              <Select
                value={manual.codigoVendedor}
                onChange={(e) => setManual({ ...manual, codigoVendedor: e.target.value })}
              >
                <option value="">Elegí un vendedor…</option>
                {vendedores.map((v) => (
                  <option key={v.id} value={v.codigo}>
                    {v.nombre ? `${v.nombre} (${v.codigo})` : v.codigo} — {v.sucursal}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo etiqueta="Nombre del cliente">
              <Input
                value={manual.nombreCliente}
                onChange={(e) => setManual({ ...manual, nombreCliente: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Correo del cliente">
              <Input
                type="email"
                value={manual.email}
                onChange={(e) => setManual({ ...manual, email: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Fecha de entrega">
              <Input
                type="date"
                value={manual.fechaEntrega}
                onChange={(e) => setManual({ ...manual, fechaEntrega: e.target.value })}
              />
            </Campo>
            <div className="sm:col-span-3">
              <button onClick={crearEncuestaManual} disabled={guardando} className={claseBoton("primario")}>
                {guardando ? "Guardando…" : "Agregar a los pendientes"}
              </button>
              <p className="mt-2 text-xs text-ink-muted">
                Queda en la lista del vendedor igual que los que vienen del Excel de fábrica. La
                diferencia: la próxima carga NO se lo lleva por delante — a los que vienen del
                archivo, si dejan de aparecer, se los da por respondidos, y a este no.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Vendedores */}
      <Card padding="p-0">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy">Vendedores</h3>
          <button onClick={() => setCreando((v) => !v)} className={claseBoton("secundario", "!py-1.5")}>
            <UserPlus className="h-4 w-4" /> Agregar a mano
          </button>
        </div>

        {creando && (
          <div className="grid gap-3 border-b border-gray-200 bg-gray-50 p-5 sm:grid-cols-4">
            <Campo etiqueta="Código" hint="7 dígitos: 4 de sucursal + 3 del vendedor">
              <Input value={nuevo.codigo} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })} placeholder="1035017" />
            </Campo>
            <Campo etiqueta="Sucursal">
              {/* Lista cerrada. El nombre se guarda en mayúsculas para que quede
                  igual al de las hojas del Excel de fábrica ("MENDOZA"), que es
                  con lo que se agrupa a los vendedores en las pantallas. */}
              <SelectorSucursal valor={nuevo.sucursal} onCambiar={(v) => setNuevo({ ...nuevo, sucursal: v })} />
            </Campo>
            <Campo etiqueta="Nombre">
              <Input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
            </Campo>
            <Campo etiqueta="Correo">
              <Input value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} type="email" />
            </Campo>
            <div className="sm:col-span-4">
              <button onClick={crearVendedor} disabled={guardando} className={claseBoton("primario")}>
                {guardando ? "Guardando…" : "Crear vendedor"}
              </button>
            </div>
          </div>
        )}

        {cargando ? (
          <div className="space-y-2 p-5">
            <SkeletonBlock className="h-10 w-full" />
            <SkeletonBlock className="h-10 w-full" />
            <SkeletonBlock className="h-10 w-full" />
          </div>
        ) : vendedores.length === 0 ? (
          <EmptyState
            icono={MailCheck}
            titulo="Todavía no cargaste ningún Excel de fábrica"
            descripcion="Subí el archivo de encuestas pendientes que baja de la plataforma de Volkswagen. Los vendedores se cargan solos a partir de ahí."
          />
        ) : (
          <div className="divide-y divide-gray-100">
            {vendedores.map((v) => {
              // Dos cosas distintas que antes eran una sola, y confundirlas
              // haría desaparecer clientes de la pantalla apenas se avisa:
              //   sinResponder = todo lo que sigue abierto (pendientes Y avisados).
              //                  Es lo que Calidad tiene que seguir viendo.
              //   sinAvisar    = solo los pendientes. Es lo que entraría en el
              //                  próximo correo, así que manda sobre el botón.
              const sinResponder = v.pendientes.filter((p) => p.estado !== "RESPONDIO");
              const sinAvisar = v.pendientes.filter((p) => p.estado === "PENDIENTE");
              const abierto = abiertos.has(v.id);
              return (
                <div key={v.id}>
                  <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <button
                      onClick={() =>
                        setAbiertos((s) => {
                          const n = new Set(s);
                          n.has(v.id) ? n.delete(v.id) : n.add(v.id);
                          return n;
                        })
                      }
                      className="flex items-center gap-2 text-left"
                      disabled={sinResponder.length === 0}
                    >
                      {sinResponder.length > 0 ? (
                        abierto ? (
                          <ChevronDown className="h-4 w-4 text-ink-muted" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-ink-muted" />
                        )
                      ) : (
                        <span className="w-4" />
                      )}
                      <span className="font-medium text-ink">{v.nombre || `Vendedor ${v.codigo}`}</span>
                    </button>
                    <span className="font-mono text-xs text-ink-muted">{v.codigo}</span>
                    <Badge tono="gris">{v.sucursal}</Badge>
                    {/* Se muestran los dos números porque responden preguntas
                        distintas: cuántos le faltan avisar (lo que sale en el
                        próximo correo) y cuántos están esperando respuesta. Un
                        vendedor con 0 sin avisar y 8 avisados no tiene nada
                        pendiente de hacer, pero tampoco está cerrado. */}
                    <Badge tono={sinAvisar.length > 0 ? "amarillo" : sinResponder.length > 0 ? "azul" : "verde"}>
                      {sinAvisar.length > 0
                        ? `${sinAvisar.length} sin avisar`
                        : sinResponder.length > 0
                          ? `${sinResponder.length} esperando respuesta`
                          : "Todo respondido"}
                    </Badge>

                    {editando === v.id ? (
                      <div className="flex flex-1 flex-wrap items-end gap-2">
                        <Campo etiqueta="Nombre">
                          <Input value={formNombre} onChange={(e) => setFormNombre(e.target.value)} />
                        </Campo>
                        <Campo etiqueta="Correo">
                          <Input value={formEmail} onChange={(e) => setFormEmail(e.target.value)} type="email" />
                        </Campo>
                        <button onClick={() => guardarVendedor(v.id)} disabled={guardando} className={claseBoton("primario", "!py-1.5")}>
                          Guardar
                        </button>
                        <button onClick={() => setEditando(null)} className={claseBoton("secundario", "!py-1.5")}>
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className={`flex-1 text-sm ${v.email ? "text-ink-muted" : "text-rojo"}`}>
                          {v.email || (
                            <span className="inline-flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5" /> falta el correo
                            </span>
                          )}
                        </span>
                        {v.ultimoAvisoEn && (
                          <span className="text-xs text-ink-muted">último aviso {fechaCorta(v.ultimoAvisoEn)}</span>
                        )}
                        <button onClick={() => abrirEdicion(v)} className={claseBoton("secundario", "!py-1 !px-2")} title="Editar nombre y correo">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => eliminarVendedor(v)}
                          disabled={guardando}
                          className={claseBoton("secundario", "!py-1 !px-2 !text-red-600")}
                          title={
                            sinResponder.length > 0
                              ? "Tiene encuestas asociadas: no se puede borrar, pero sí desactivar"
                              : "Eliminar vendedor"
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        {sinAvisar.length > 0 && v.email && (
                          <button
                            onClick={() => avisar([v.codigo])}
                            disabled={avisando || estadoMail?.configurado === false}
                            className={claseBoton("secundario", "!py-1 !px-2")}
                            title="Avisarle solo a este vendedor"
                          >
                            <Mail className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {abierto && sinResponder.length > 0 && (
                    <div className="overflow-x-auto bg-gray-50 px-5 pb-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                            <th className="py-2 pr-4">Cliente</th>
                            <th className="py-2 pr-4">Correo</th>
                            <th className="py-2 pr-4">Dominio</th>
                            <th className="py-2 pr-4">Canal</th>
                            <th className="py-2 pr-4">Entrega</th>
                            {/* Sin esto, en esta vista no se distinguiría a
                                quién ya se le avisó de a quién no, que es
                                justamente lo que decide si el próximo correo lo
                                incluye. */}
                            <th className="py-2 pr-4">Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sinResponder.map((p) => (
                            <tr key={p.id} className="border-t border-gray-200">
                              <td className="py-2 pr-4">
                                {p.nombreCliente}
                                {p.observacionesFabrica.length > 0 && (
                                  <span className="ml-2 text-xs text-amber-700" title={p.observacionesFabrica.join(" · ")}>
                                    (observado por fábrica)
                                  </span>
                                )}
                              </td>
                              <td className="py-2 pr-4 text-ink-muted">{p.email}</td>
                              <td className="py-2 pr-4 font-mono text-xs">{p.dominio || "—"}</td>
                              <td className="py-2 pr-4 text-ink-muted">{p.canalVentas || "—"}</td>
                              <td className="py-2 pr-4 text-ink-muted">{fechaCorta(p.fechaEntrega)}</td>
                              <td className="py-2 pr-4">
                                <Badge tono={p.estado === "PENDIENTE" ? "amarillo" : "azul"}>
                                  {ETIQUETA_ESTADO[p.estado]}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
