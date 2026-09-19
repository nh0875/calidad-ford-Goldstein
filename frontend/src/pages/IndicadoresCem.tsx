// Indicadores CEM por trimestre (Volkswagen).
//
// Es la planilla "Q 2026" de Calidad adentro del sistema (pedido del 17-09-2026):
// por trimestre y provincia, un renglón por mes con patentamientos, base CEM,
// encuestas efectivas, mails válidos y OS, el total del trimestre y los objetivos.
// Los números se cargan a mano; las cuentas y los colores (verde si llega al
// objetivo, rojo si no) los hace el backend con las mismas fórmulas de la planilla
// (services/indicadores-cem.service.ts). Lo ve cualquier perfil; cargan Calidad y
// los administradores.
//
// Dos áreas desde el 18-09-2026: Ventas y Posventa, con un selector arriba y
// objetivos propios. Desde el 19-09-2026 Posventa tiene las columnas de SU planilla
// ("Postventa Q 2026", solo Mendoza): mails enviados, encuestas efectivas, las notas
// Q1 a Q4 (Trato, Organización, Calidad de reparación y LVS), la escala que sale de
// la nota LVS con la tabla "Objetivos LVS" y la tasa de respuesta. Por eso cada área
// tiene su tabla (TablaVentas / TablaPosventa) y su bloque de objetivos.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Car, Gauge, Pencil, Wrench } from "lucide-react";
import { apiGet, apiPutJson } from "../lib/api";
import { getMarca } from "../lib/marca";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { claseBoton } from "../components/ui/Button";
import { Select } from "../components/ui/Field";
import { SkeletonBlock } from "../components/ui/Skeleton";
import { etiquetaMes } from "../components/SeguimientoAnimaciones";

type AreaCem = "VENTAS" | "POSVENTA";

/** Lo que cambia de una área a otra en el encabezado de la pantalla. */
const CONFIG_AREA: Record<AreaCem, { nombre: string; descripcion: string }> = {
  VENTAS: {
    nombre: "Ventas",
    descripcion:
      "Patentamientos, base CEM, encuestas efectivas, mails válidos y OS de cada mes, por provincia. Los números se " +
      "cargan a mano; los porcentajes, los totales y la comparación con los objetivos los calcula el sistema.",
  },
  POSVENTA: {
    nombre: "Posventa",
    descripcion:
      "Mails enviados, encuestas efectivas y las notas Q1 a Q4 de cada mes del taller, como en la planilla de " +
      "Posventa. Los números se cargan a mano, igual que las notas del total del trimestre (las publica fábrica); la " +
      "tasa de respuesta, los totales y la escala los calcula el sistema.",
  },
};

/** Las columnas de la tabla de Ventas (planilla "Q 2026"). */
const COLUMNAS_VENTAS = { base: "Patentam.", baseLargo: "patentamientos", conSeparacion: true };

// El área elegida se recuerda en este navegador (quien carga Posventa no tiene
// que cambiarla cada vez). Con try/catch: en una ventana privada o con los datos
// del sitio bloqueados, localStorage tira error y la pantalla tiene que andar igual.
const CLAVE_AREA = "calidad.indicadoresCem.area";
function areaGuardada(): AreaCem {
  try {
    return localStorage.getItem(CLAVE_AREA) === "POSVENTA" ? "POSVENTA" : "VENTAS";
  } catch {
    return "VENTAS";
  }
}

const CAMPOS_NOTA = ["notaTrato", "notaOrganizacion", "notaCalidadReparacion", "notaLvs"] as const;
type CampoNota = (typeof CAMPOS_NOTA)[number];
const CAMPOS_MES_VENTAS = [
  "patentamientos",
  "baseCem",
  "baseCemTradicional",
  "baseCemAutoahorro",
  "encuestasEfectivas",
  "baseSinDuplicados",
  "mailOk",
  "os",
] as const;
const CAMPOS_MES_POSVENTA = ["mailsEnviados", "encuestasEfectivas", ...CAMPOS_NOTA] as const;
const CAMPOS_MES = [...CAMPOS_MES_VENTAS, "mailsEnviados", ...CAMPOS_NOTA] as const;
type CampoMes = (typeof CAMPOS_MES)[number];
type Cumple = boolean | null;
/** 1 a 4 cumple (1 es la mejor); 5 = No cumple. */
type Escala = 1 | 2 | 3 | 4 | 5 | null;

interface Mes extends Record<CampoMes, number | null> {
  periodo: string;
  porcentajeCarga: number | null;
  porcentajeEfectivas: number | null;
  porcentajeMailValidos: number | null;
  tasaRespuesta: number | null;
  escala: Escala;
  baseNoSuma: boolean;
  cumple: { cargas: Cumple; mailValidos: Cumple; os: Cumple };
}

interface Total {
  patentamientos: number | null;
  baseCem: number | null;
  baseCemTradicional: number | null;
  baseCemAutoahorro: number | null;
  encuestasEfectivas: number | null;
  baseSinDuplicados: number | null;
  mailOk: number | null;
  porcentajeCarga: number | null;
  porcentajeEfectivas: number | null;
  porcentajeMailValidos: number | null;
  os: number | null;
  resultadoAuditoria: number | null;
  cargasNecesarias: number | null;
  cumple: { cargas: Cumple; mailValidos: Cumple; os: Cumple };
  mailsEnviados: number | null;
  tasaRespuesta: number | null;
  notaTrato: number | null;
  notaOrganizacion: number | null;
  notaCalidadReparacion: number | null;
  notaLvs: number | null;
  escala: Escala;
}

const CAMPOS_ESCALA = ["lvsEscala1", "lvsEscala2", "lvsEscala3", "lvsEscala4"] as const;
type CampoEscala = (typeof CAMPOS_ESCALA)[number];

interface Objetivos extends Record<CampoEscala, number | null> {
  os: number | null;
  cargas: number | null;
  mailValidos: number | null;
}

interface Trimestre {
  anio: number;
  trimestre: number;
  periodos: string[];
  objetivos: Objetivos;
  sucursales: Array<{ sucursal: string; meses: Mes[]; total: Total }>;
}

interface Respuesta {
  anio: number;
  area: AreaCem;
  anios: number[];
  sucursales: string[];
  trimestres: Trimestre[];
  permisos: { cargar: boolean; provincia: string | null };
}

const NOMBRE_TRIMESTRE = ["Primer trimestre", "Segundo trimestre", "Tercer trimestre", "Cuarto trimestre"];

// ---------------------------------------------------------------- formato ----
const fmtEntero = (n: number | null) => (n === null ? "—" : n.toLocaleString("es-AR"));
const fmtDecimal = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number | null) => (n === null ? "—" : `${fmtDecimal(n)} %`);

/** Verde si llega al objetivo, rojo si no; sin objetivo, sin color. */
function claseCumple(c: Cumple): string {
  if (c === true) return "bg-green-50 font-semibold text-green-800";
  if (c === false) return "bg-red-50 font-semibold text-red-700";
  return "";
}

/** "4,86" o "4.86" → 4.86; vacío → null; basura → undefined (error). */
function leerNumero(texto: string, entero: boolean): number | null | undefined {
  const t = texto.trim().replace(/\s/g, "");
  if (t === "") return null;
  // Con coma decimal, los puntos son de miles ("1.234,5"); sin coma, el punto es decimal.
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normal);
  if (!Number.isFinite(n)) return undefined;
  if (entero && !Number.isInteger(n)) return undefined;
  return n;
}

const aTexto = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

/** Qué campos se cargan en cada área: cada una tiene los de su planilla. */
function camposDelArea(area: AreaCem): readonly CampoMes[] {
  return area === "POSVENTA" ? CAMPOS_MES_POSVENTA : CAMPOS_MES_VENTAS;
}

const ETIQUETA_CAMPO: Record<CampoMes, string> = {
  patentamientos: "patentamientos",
  baseCem: "base CEM",
  baseCemTradicional: "tradicional",
  baseCemAutoahorro: "autoahorro",
  encuestasEfectivas: "encuestas efectivas",
  baseSinDuplicados: "base sin duplicados",
  mailOk: "mail OK",
  os: "OS",
  mailsEnviados: "mails enviados",
  notaTrato: "Q1 – Trato",
  notaOrganizacion: "Q2 – Organización",
  notaCalidadReparacion: "Q3 – Calidad de reparación",
  notaLvs: "Q4 – LVS",
};

/**
 * Lee un casillero con los MISMOS límites que el backend. Así un error de tipeo (un
 * OS "489" por olvidar la coma) se frena antes de guardar, y no queda la mitad de
 * los meses guardados y la otra mitad no.
 */
function leerCampo(
  texto: string,
  tipo: "entero" | "os" | "nota" | "porcentaje"
): { valor: number | null } | { error: string } {
  const n = leerNumero(texto, tipo === "entero");
  if (n === undefined) return { error: tipo === "entero" ? "tiene que ser un número entero" : "tiene que ser un número" };
  if (n === null) return { valor: null };
  if (tipo === "entero" && (n < 0 || n > 1_000_000)) return { error: "tiene que estar entre 0 y 1.000.000" };
  if (tipo === "os" && (n < 0 || n > 5)) return { error: "el OS va de 0 a 5" };
  if (tipo === "nota" && (n < 0 || n > 5)) return { error: "las notas van de 0 a 5" };
  if (tipo === "porcentaje" && (n < 0 || n > 100)) return { error: "un porcentaje va de 0 a 100" };
  return { valor: n };
}

const TRIMESTRE_ACTUAL = Math.floor(new Date().getMonth() / 3) + 1;

// ---------------------------------------------------------------- pantalla ----
export default function IndicadoresCem() {
  const marca = getMarca();
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [trimestre, setTrimestre] = useState(TRIMESTRE_ACTUAL);
  const [area, setArea] = useState<AreaCem>(areaGuardada);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  // Lo que se está mirando AHORA. Un pedido que vuelve tarde (se cambió de área o de
  // año mientras tanto, o terminó un guardado de la pantalla anterior) no puede pisar
  // lo que se ve: dejaba la pantalla cargando para siempre o con números de otro año.
  const seleccion = useRef({ anio, area });
  seleccion.current = { anio, area };
  const esVigente = (a: number, ar: AreaCem) => seleccion.current.anio === a && seleccion.current.area === ar;

  const cargar = useCallback(async () => {
    try {
      const respuesta = await apiGet<Respuesta>(`/api/indicadores-cem?anio=${anio}&area=${area}`);
      if (!esVigente(anio, area)) return;
      setDatos(respuesta);
      setError(null);
    } catch (err) {
      if (!esVigente(anio, area)) return;
      setError(err instanceof Error ? err.message : "No pudimos cargar los indicadores.");
    }
    // esVigente lee un ref: no hace falta en las dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anio, area]);

  /** Al terminar de guardar: el aviso y la recarga, solo si se sigue mirando lo que se guardó. */
  const alGuardar = (ar: AreaCem, a: number) => async (m: string) => {
    if (!esVigente(a, ar)) return;
    setMensaje(m);
    await cargar();
  };

  function cambiarArea(nueva: AreaCem) {
    if (nueva === area) return;
    // Se vacía lo que se veía: si no, durante la carga quedarían los números de la
    // OTRA área con el título de la nueva, y alguien podría tomarlos por buenos.
    setDatos(null);
    setMensaje(null);
    setArea(nueva);
    try {
      localStorage.setItem(CLAVE_AREA, nueva);
    } catch {
      // sin almacenamiento del navegador: solo no se recuerda la próxima vez
    }
  }

  useEffect(() => {
    if (marca.modulos.indicadoresCem) cargar();
  }, [cargar, marca.modulos.indicadoresCem]);

  // Solo se muestra si lo que llegó es del área y el año elegidos (mientras llega lo
  // nuevo, el esqueleto de carga; nunca los números de otro año con este título).
  const actual = useMemo(
    () =>
      datos && datos.area === area && datos.anio === anio
        ? datos.trimestres.find((t) => t.trimestre === trimestre) ?? null
        : null,
    [datos, trimestre, area, anio]
  );
  const config = CONFIG_AREA[area];

  if (!marca.modulos.indicadoresCem) {
    return <Alert tono="info">Esta pantalla es de Volkswagen. En {marca.nombre} no aplica.</Alert>;
  }

  return (
    <div className="space-y-4">
      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}

      <Card padding="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-navy">
              Indicadores CEM · {config.nombre}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-ink-muted">{config.descripcion}</p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="cem-anio" className="text-sm font-medium text-ink">
              Año
            </label>
            <Select id="cem-anio" value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="!w-28">
              {(datos?.anios ?? [anio]).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {/* Área y trimestre juntos, en la misma fila: son las dos cosas que dicen
            QUÉ se está mirando. El área va primero y separada por una raya, así se
            lee "Posventa · Q3" y no queda perdida al costado según el ancho. */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SelectorArea valor={area} onCambiar={cambiarArea} />
          <span className="hidden h-7 w-px bg-gray-200 sm:block" aria-hidden="true" />
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Trimestre">
            {[1, 2, 3, 4].map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={t === trimestre}
                onClick={() => setTrimestre(t)}
                className={claseBoton(t === trimestre ? "primario" : "secundario", "!py-1.5")}
              >
                Q{t} · {NOMBRE_TRIMESTRE[t - 1]}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {!actual && !error && <SkeletonBlock className="h-72 w-full" />}

      {datos && actual && area === "POSVENTA" && (
        <>
          <ObjetivosPosventa
            key={`obj-${area}-${anio}-${trimestre}`}
            trimestre={actual}
            puedeEditar={datos.permisos.cargar && !datos.permisos.provincia}
            onGuardado={alGuardar(area, anio)}
            onError={(e) => {
              setError(e);
              if (e) setMensaje(null);
            }}
          />
          {actual.sucursales.map((s) => (
            <TablaPosventa
              key={`${area}-${anio}-${trimestre}-${s.sucursal}`}
              trimestre={actual}
              sucursal={s.sucursal}
              meses={s.meses}
              total={s.total}
              puedeEditar={
                datos.permisos.cargar &&
                (!datos.permisos.provincia || datos.permisos.provincia.toLowerCase() === s.sucursal.toLowerCase())
              }
              onGuardado={alGuardar(area, anio)}
              onError={(e) => {
                setError(e);
                if (e) setMensaje(null);
              }}
              onRecargar={cargar}
            />
          ))}
        </>
      )}

      {datos && actual && area === "VENTAS" && (
        <>
          <BloqueObjetivos
            key={`obj-${area}-${anio}-${trimestre}`}
            area={area}
            trimestre={actual}
            puedeEditar={datos.permisos.cargar && !datos.permisos.provincia}
            onGuardado={alGuardar(area, anio)}
            onError={(e) => {
              setError(e);
              if (e) setMensaje(null);
            }}
          />
          {actual.sucursales.map((s) => (
            <TablaVentas
              key={`${area}-${anio}-${trimestre}-${s.sucursal}`}
              area={area}
              trimestre={actual}
              sucursal={s.sucursal}
              meses={s.meses}
              total={s.total}
              puedeEditar={
                datos.permisos.cargar &&
                (!datos.permisos.provincia || datos.permisos.provincia.toLowerCase() === s.sucursal.toLowerCase())
              }
              onGuardado={alGuardar(area, anio)}
              onError={(e) => {
                setError(e);
                if (e) setMensaje(null);
              }}
              onRecargar={cargar}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- objetivos ----
function BloqueObjetivos({
  area,
  trimestre,
  puedeEditar,
  onGuardado,
  onError,
}: {
  area: AreaCem;
  trimestre: Trimestre;
  puedeEditar: boolean;
  onGuardado: (mensaje: string) => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const { objetivos } = trimestre;
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ os: "", cargas: "", mailValidos: "" });
  const [guardando, setGuardando] = useState(false);

  function abrir() {
    setForm({ os: aTexto(objetivos.os), cargas: aTexto(objetivos.cargas), mailValidos: aTexto(objetivos.mailValidos) });
    setEditando(true);
  }

  async function guardar() {
    const os = leerCampo(form.os, "os");
    const cargas = leerCampo(form.cargas, "porcentaje");
    const mailValidos = leerCampo(form.mailValidos, "porcentaje");
    for (const [etiqueta, r, texto] of [
      ["OS", os, form.os],
      ["Cargas", cargas, form.cargas],
      ["Mails válidos", mailValidos, form.mailValidos],
    ] as const) {
      if ("error" in r) {
        onError(`Revisá el objetivo de ${etiqueta}: ${r.error} ("${texto}").`);
        return;
      }
    }
    if ("error" in os || "error" in cargas || "error" in mailValidos) return;
    setGuardando(true);
    onError(null);
    try {
      await apiPutJson("/api/indicadores-cem/objetivos", {
        area,
        anio: trimestre.anio,
        trimestre: trimestre.trimestre,
        os: os.valor,
        cargas: cargas.valor,
        mailValidos: mailValidos.valor,
      });
      setEditando(false);
      await onGuardado(`Objetivos de ${CONFIG_AREA[area].nombre} del Q${trimestre.trimestre} ${trimestre.anio} guardados.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudieron guardar los objetivos.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Card padding="p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="font-display text-sm font-bold uppercase tracking-wide text-navy">
          Objetivos {CONFIG_AREA[area].nombre} · Q{trimestre.trimestre} {trimestre.anio}
        </span>
        {editando ? (
          <>
            {(
              [
                ["os", "OS"],
                ["cargas", "Cargas (%)"],
                ["mailValidos", "Mails válidos (%)"],
              ] as const
            ).map(([campo, etiqueta]) => (
              <label key={campo} className="flex items-center gap-2 text-sm text-ink">
                {etiqueta}
                <input
                  value={form[campo]}
                  onChange={(e) => setForm({ ...form, [campo]: e.target.value })}
                  inputMode="decimal"
                  className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm"
                />
              </label>
            ))}
            <button onClick={guardar} disabled={guardando} className={claseBoton("primario", "!py-1 !px-3")}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button onClick={() => setEditando(false)} className={claseBoton("secundario", "!py-1 !px-3")}>
              Cancelar
            </button>
          </>
        ) : (
          <>
            <span className="text-sm text-ink">
              OS: <strong>{fmtDecimal(objetivos.os)}</strong>
            </span>
            <span className="text-sm text-ink">
              Cargas: <strong>{fmtPct(objetivos.cargas)}</strong>
            </span>
            <span className="text-sm text-ink">
              Mails válidos: <strong>{fmtPct(objetivos.mailValidos)}</strong>
            </span>
            {puedeEditar && (
              <button onClick={abrir} className={claseBoton("secundario", "!py-1 !px-2")} title="Cargar o corregir los objetivos">
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
            )}
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Son los de {CONFIG_AREA[area].nombre} y valen para las dos provincias. En verde lo que llega al objetivo y en
        rojo lo que no: el % de carga contra "Cargas", el % de mails válidos contra "Mails válidos" y el OS contra "OS".
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------- tabla de Ventas ----
type FormMes = Record<CampoMes, string>;

function TablaVentas({
  area,
  trimestre,
  sucursal,
  meses,
  total,
  puedeEditar,
  onGuardado,
  onError,
  onRecargar,
}: {
  area: AreaCem;
  trimestre: Trimestre;
  sucursal: string;
  meses: Mes[];
  total: Total;
  puedeEditar: boolean;
  onGuardado: (mensaje: string) => Promise<void>;
  onError: (e: string | null) => void;
  /** Si algo falla a mitad de guardar: que la tabla muestre lo que de verdad quedó. */
  onRecargar: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<Record<string, FormMes>>({});
  const [formTrimestre, setFormTrimestre] = useState({ os: "", resultadoAuditoria: "" });
  const [guardando, setGuardando] = useState(false);
  const config = { ...CONFIG_AREA[area], ...COLUMNAS_VENTAS };
  const campos = camposDelArea(area);
  const etiquetaCampo = (c: CampoMes) => (c === "patentamientos" ? config.baseLargo : ETIQUETA_CAMPO[c]);

  function abrir() {
    setForm(
      Object.fromEntries(
        meses.map((m) => [m.periodo, Object.fromEntries(CAMPOS_MES.map((c) => [c, aTexto(m[c])])) as FormMes])
      )
    );
    setFormTrimestre({ os: aTexto(total.os), resultadoAuditoria: aTexto(total.resultadoAuditoria) });
    setEditando(true);
  }

  async function guardar() {
    const cambiosMeses: Array<{ periodo: string; datos: Partial<Record<CampoMes, number | null>> }> = [];
    for (const m of meses) {
      const datos: Partial<Record<CampoMes, number | null>> = {};
      for (const c of campos) {
        const r = leerCampo(form[m.periodo]?.[c] ?? "", c === "os" ? "os" : "entero");
        if ("error" in r) {
          onError(`Revisá ${etiquetaMes(m.periodo)}, ${etiquetaCampo(c)}: ${r.error} ("${form[m.periodo]?.[c]}").`);
          return;
        }
        if (r.valor !== m[c]) datos[c] = r.valor;
      }
      if (Object.keys(datos).length) cambiosMeses.push({ periodo: m.periodo, datos });
    }
    const osT = leerCampo(formTrimestre.os, "os");
    if ("error" in osT) {
      onError(`Revisá el OS del trimestre: ${osT.error} ("${formTrimestre.os}").`);
      return;
    }
    const auditoria = leerCampo(formTrimestre.resultadoAuditoria, "porcentaje");
    if ("error" in auditoria) {
      onError(`Revisá el resultado de auditoría: ${auditoria.error} ("${formTrimestre.resultadoAuditoria}").`);
      return;
    }
    const os = osT.valor;
    const resultadoAuditoria = auditoria.valor;
    const cambiaTrimestre = os !== total.os || resultadoAuditoria !== total.resultadoAuditoria;

    setGuardando(true);
    onError(null);
    try {
      for (const c of cambiosMeses) {
        await apiPutJson("/api/indicadores-cem/mes", { area, periodo: c.periodo, sucursal, ...c.datos });
      }
      if (cambiaTrimestre) {
        await apiPutJson("/api/indicadores-cem/trimestre", {
          area,
          anio: trimestre.anio,
          trimestre: trimestre.trimestre,
          sucursal,
          os,
          resultadoAuditoria,
        });
      }
      setEditando(false);
      await onGuardado(
        cambiosMeses.length || cambiaTrimestre
          ? `Indicadores de ${config.nombre} de ${sucursal} guardados.`
          : "No había cambios para guardar."
      );
    } catch (err) {
      const aviso =
        `${err instanceof Error ? err.message : "No se pudieron guardar los indicadores."} ` +
        "Lo que se llegó a guardar antes del error ya se ve en la tabla; revisá y volvé a guardar.";
      // Sin recargar, la tabla seguiría con los números viejos aunque algún mes ya se
      // haya guardado, y la próxima comparación de "qué cambió" saldría mal. Primero
      // se recarga y DESPUÉS se avisa: la recarga limpia los errores, y al revés el
      // aviso desaparecía enseguida.
      await onRecargar().catch(() => {});
      onError(aviso);
    } finally {
      setGuardando(false);
    }
  }

  const celdaInput = (periodo: string, campo: CampoMes) => (
    <input
      value={form[periodo]?.[campo] ?? ""}
      onChange={(e) => setForm({ ...form, [periodo]: { ...form[periodo], [campo]: e.target.value } })}
      inputMode={campo === "os" ? "decimal" : "numeric"}
      aria-label={`${etiquetaCampo(campo)} de ${etiquetaMes(periodo)}`}
      className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right text-sm"
    />
  );

  const th = "px-2 py-2 text-right";
  const td = "whitespace-nowrap px-2 py-2 text-right tabular-nums";

  return (
    <Card padding="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
        <h3 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-navy">
          <Gauge className="h-4 w-4" aria-hidden="true" />
          {sucursal} · Q{trimestre.trimestre} {trimestre.anio}
          <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-navy">
            {config.nombre}
          </span>
        </h3>
        {puedeEditar &&
          (editando ? (
            <div className="flex gap-2">
              <button onClick={guardar} disabled={guardando} className={claseBoton("primario", "!py-1.5")}>
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              <button onClick={() => setEditando(false)} className={claseBoton("secundario", "!py-1.5")}>
                Cancelar
              </button>
            </div>
          ) : (
            <button onClick={abrir} className={claseBoton("secundario", "!py-1.5")}>
              <Pencil className="h-4 w-4" /> Cargar / corregir
            </button>
          ))}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              <th className="px-4 py-2 text-left">Mes</th>
              <th className={th} title={config.baseLargo}>
                {config.base}
              </th>
              <th className={th}>Base CEM</th>
              {config.conSeparacion && (
                <>
                  <th className={th}>Tradicional</th>
                  <th className={th}>Autoahorro</th>
                </>
              )}
              <th className={th}>% de carga</th>
              <th className={th}>Encuestas efectivas</th>
              <th className={th} title="Encuestas efectivas sobre la base CEM">
                % efectivas
              </th>
              <th className={th}>Base sin duplicados</th>
              <th className={th}>Mail OK</th>
              <th className={th}>% mails válidos</th>
              <th className={th}>OS</th>
              <th className="px-4 py-2 text-right">Resultado auditoría</th>
            </tr>
          </thead>
          <tbody>
            {meses.map((m) => (
              <tr key={m.periodo} className="border-b border-gray-100">
                <td className="whitespace-nowrap px-4 py-2 font-medium text-ink">
                  {etiquetaMes(m.periodo)}
                  {m.baseNoSuma && !editando && (
                    <span
                      className="ml-1 inline-flex align-middle text-amber-600"
                      title="La base CEM no es igual a tradicional + autoahorro: revisá si hay un número mal cargado."
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                    </span>
                  )}
                </td>
                {editando ? (
                  <>
                    <td className={td}>{celdaInput(m.periodo, "patentamientos")}</td>
                    <td className={td}>{celdaInput(m.periodo, "baseCem")}</td>
                    {config.conSeparacion && (
                      <>
                        <td className={td}>{celdaInput(m.periodo, "baseCemTradicional")}</td>
                        <td className={td}>{celdaInput(m.periodo, "baseCemAutoahorro")}</td>
                      </>
                    )}
                    <td className={`${td} text-ink-muted`}>{fmtPct(m.porcentajeCarga)}</td>
                    <td className={td}>{celdaInput(m.periodo, "encuestasEfectivas")}</td>
                    <td className={`${td} text-ink-muted`}>{fmtPct(m.porcentajeEfectivas)}</td>
                    <td className={td}>{celdaInput(m.periodo, "baseSinDuplicados")}</td>
                    <td className={td}>{celdaInput(m.periodo, "mailOk")}</td>
                    <td className={`${td} text-ink-muted`}>{fmtPct(m.porcentajeMailValidos)}</td>
                    <td className={td}>{celdaInput(m.periodo, "os")}</td>
                    <td className="px-4 py-2" />
                  </>
                ) : (
                  <>
                    <td className={td}>{fmtEntero(m.patentamientos)}</td>
                    <td className={td}>{fmtEntero(m.baseCem)}</td>
                    {config.conSeparacion && (
                      <>
                        <td className={td}>{fmtEntero(m.baseCemTradicional)}</td>
                        <td className={td}>{fmtEntero(m.baseCemAutoahorro)}</td>
                      </>
                    )}
                    <td className={`${td} ${claseCumple(m.cumple.cargas)}`}>{fmtPct(m.porcentajeCarga)}</td>
                    <td className={td}>{fmtEntero(m.encuestasEfectivas)}</td>
                    <td className={td}>{fmtPct(m.porcentajeEfectivas)}</td>
                    <td className={td}>{fmtEntero(m.baseSinDuplicados)}</td>
                    <td className={td}>{fmtEntero(m.mailOk)}</td>
                    <td className={`${td} ${claseCumple(m.cumple.mailValidos)}`}>{fmtPct(m.porcentajeMailValidos)}</td>
                    <td className={`${td} ${claseCumple(m.cumple.os)}`}>{fmtDecimal(m.os)}</td>
                    <td className="px-4 py-2" />
                  </>
                )}
              </tr>
            ))}
            <tr className="border-b border-gray-200 bg-gray-50 font-semibold text-ink">
              <td className="px-4 py-2">Total</td>
              <td className={td}>{fmtEntero(total.patentamientos)}</td>
              <td className={td}>{fmtEntero(total.baseCem)}</td>
              {config.conSeparacion && (
                <>
                  <td className={td}>{fmtEntero(total.baseCemTradicional)}</td>
                  <td className={td}>{fmtEntero(total.baseCemAutoahorro)}</td>
                </>
              )}
              <td className={`${td} ${claseCumple(total.cumple.cargas)}`}>{fmtPct(total.porcentajeCarga)}</td>
              <td className={td}>{fmtEntero(total.encuestasEfectivas)}</td>
              <td className={td} title="Promedio de los porcentajes de los meses, como en la planilla">
                {fmtPct(total.porcentajeEfectivas)}
              </td>
              <td className={td}>{fmtEntero(total.baseSinDuplicados)}</td>
              <td className={td}>{fmtEntero(total.mailOk)}</td>
              <td className={`${td} ${claseCumple(total.cumple.mailValidos)}`}>{fmtPct(total.porcentajeMailValidos)}</td>
              {editando ? (
                <Fragment>
                  <td className={td}>
                    <input
                      value={formTrimestre.os}
                      onChange={(e) => setFormTrimestre({ ...formTrimestre, os: e.target.value })}
                      inputMode="decimal"
                      aria-label="OS del trimestre"
                      className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right text-sm"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      value={formTrimestre.resultadoAuditoria}
                      onChange={(e) => setFormTrimestre({ ...formTrimestre, resultadoAuditoria: e.target.value })}
                      inputMode="decimal"
                      aria-label="Resultado de auditoría (%)"
                      className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right text-sm"
                    />
                  </td>
                </Fragment>
              ) : (
                <Fragment>
                  <td className={`${td} ${claseCumple(total.cumple.os)}`} title="El OS del trimestre que publica fábrica">
                    {fmtDecimal(total.os)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtPct(total.resultadoAuditoria)}</td>
                </Fragment>
              )}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-sm text-ink">
        <span>
          {trimestre.objetivos.cargas === null ? "Cargas necesarias" : `${fmtDecimal(trimestre.objetivos.cargas)} % de cargas`}:{" "}
          <strong>{fmtDecimal(total.cargasNecesarias)}</strong>
          <span className="ml-1 text-xs text-ink-muted">({config.baseLargo} del trimestre × objetivo de cargas)</span>
        </span>
        {editando && (
          <span className="text-xs text-ink-muted">
            Números enteros, salvo el OS (4,86). Un casillero vacío queda sin dato. El OS y la auditoría del total son los
            del trimestre.
          </span>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Posventa ----
//
// La planilla "Postventa Q 2026" (19-09-2026): una tabla por provincia (hoy solo
// Mendoza) con mails enviados, encuestas efectivas, las notas Q1 a Q4, la escala y
// la tasa de respuesta; y arriba la tabla "Objetivos LVS" del trimestre.

const ETIQUETA_NOTA: Record<CampoNota, { corta: string; larga: string }> = {
  notaTrato: { corta: "Q1 · Trato", larga: "Q1 – Trato" },
  notaOrganizacion: { corta: "Q2 · Organización", larga: "Q2 – Organización" },
  notaCalidadReparacion: { corta: "Q3 · Calidad de reparación", larga: "Q3 – Calidad de reparación" },
  notaLvs: { corta: "Q4 · LVS", larga: "Q4 – LVS (satisfacción general): de ella sale la escala" },
};

/**
 * "Escala 2" en verde (cumple) o "No cumple" en rojo (Escala 5); sin escala, una raya.
 * `apagado` mientras se edita: es la escala de lo GUARDADO, y en color contradecía la
 * nota que se está escribiendo (igual que la tasa, que en edición también se apaga).
 */
function ChipEscala({ escala, apagado = false }: { escala: Escala; apagado?: boolean }) {
  if (escala === null) return <span className="text-ink-muted">—</span>;
  if (apagado) return <span className="text-xs text-ink-muted">{escala === 5 ? "No cumple" : `Escala ${escala}`}</span>;
  if (escala === 5) {
    return (
      <span
        className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200"
        title="Escala 5: la nota LVS está por debajo de la Escala 4"
      >
        No cumple
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800 ring-1 ring-inset ring-green-200">
      Escala {escala}
    </span>
  );
}

/** Verde si la escala cumple (1 a 4), rojo si es la 5. */
const claseEscala = (e: Escala) => claseCumple(e === null ? null : e !== 5);

/**
 * Los rangos de la tabla como los escribe la planilla ("> 4,87", "4,85 – 4,87", …,
 * "< 4,80"), a partir de desde dónde empieza cada escala. null si la tabla no está.
 */
function rangosEscala(o: Objetivos): string[] | null {
  const desde = CAMPOS_ESCALA.map((c) => o[c]);
  if (desde.some((d) => d === null)) return null;
  const [e1, e2, e3, e4] = desde as number[];
  const rango = (desdeN: number, siguiente: number) => {
    const hasta = siguiente - 0.01;
    return fmtDecimal(desdeN) === fmtDecimal(hasta) ? fmtDecimal(desdeN) : `${fmtDecimal(desdeN)} – ${fmtDecimal(hasta)}`;
  };
  return [`> ${fmtDecimal(e1 - 0.01)}`, rango(e2, e1), rango(e3, e2), rango(e4, e3), `< ${fmtDecimal(e4)}`];
}

function ObjetivosPosventa({
  trimestre,
  puedeEditar,
  onGuardado,
  onError,
}: {
  trimestre: Trimestre;
  puedeEditar: boolean;
  onGuardado: (mensaje: string) => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const { objetivos } = trimestre;
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<Record<CampoEscala, string>>({ lvsEscala1: "", lvsEscala2: "", lvsEscala3: "", lvsEscala4: "" });
  const [guardando, setGuardando] = useState(false);
  const rangos = rangosEscala(objetivos);

  function abrir() {
    setForm(Object.fromEntries(CAMPOS_ESCALA.map((c) => [c, aTexto(objetivos[c])])) as Record<CampoEscala, string>);
    setEditando(true);
  }

  async function guardar() {
    const valores: Array<number | null> = [];
    for (const [i, c] of CAMPOS_ESCALA.entries()) {
      const r = leerCampo(form[c], "nota");
      if ("error" in r) {
        onError(`Revisá desde dónde empieza la Escala ${i + 1}: ${r.error} ("${form[c]}").`);
        return;
      }
      valores.push(r.valor);
    }
    // Las mismas reglas que el backend: la tabla entera o vacía, y de mayor a menor.
    const cargadas = valores.filter((v) => v !== null).length;
    if (cargadas > 0 && cargadas < 4) {
      onError("Completá las cuatro escalas (o dejalas todas vacías).");
      return;
    }
    if (cargadas === 4) {
      for (let i = 1; i < 4; i++) {
        if (!(Math.round(valores[i - 1]! * 100) > Math.round(valores[i]! * 100))) {
          onError(`La Escala ${i} tiene que empezar más arriba que la Escala ${i + 1}.`);
          return;
        }
      }
    }
    setGuardando(true);
    onError(null);
    try {
      await apiPutJson("/api/indicadores-cem/objetivos", {
        area: "POSVENTA",
        anio: trimestre.anio,
        trimestre: trimestre.trimestre,
        ...Object.fromEntries(CAMPOS_ESCALA.map((c, i) => [c, valores[i]])),
      });
      setEditando(false);
      await onGuardado(`Objetivos LVS de Posventa del Q${trimestre.trimestre} ${trimestre.anio} guardados.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudieron guardar los objetivos.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Card padding="p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-display text-sm font-bold uppercase tracking-wide text-navy">
          Objetivos LVS Posventa · Q{trimestre.trimestre} {trimestre.anio}
        </span>
        {editando ? (
          <>
            {CAMPOS_ESCALA.map((c, i) => (
              <label key={c} className="flex items-center gap-2 text-sm text-ink">
                Escala {i + 1} desde
                <input
                  value={form[c]}
                  onChange={(e) => setForm({ ...form, [c]: e.target.value })}
                  inputMode="decimal"
                  className="w-16 rounded-md border border-gray-300 px-2 py-1 text-right text-sm"
                />
              </label>
            ))}
            <button onClick={guardar} disabled={guardando} className={claseBoton("primario", "!py-1 !px-3")}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button onClick={() => setEditando(false)} className={claseBoton("secundario", "!py-1 !px-3")}>
              Cancelar
            </button>
          </>
        ) : (
          <>
            {rangos ? (
              <ul className="flex flex-wrap gap-2" aria-label="Tabla de escalas LVS">
                {rangos.map((r, i) => (
                  <li
                    key={i}
                    className={`rounded-lg px-2.5 py-1 text-sm ring-1 ring-inset ${
                      i === 4 ? "bg-red-50 text-red-800 ring-red-200" : "bg-gray-50 text-ink ring-gray-200"
                    }`}
                  >
                    <span className="font-semibold">{i === 4 ? "Escala 5 · No cumple" : `Escala ${i + 1}`}</span>{" "}
                    <span className="tabular-nums">{r}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-sm text-ink-muted">Sin tabla de escalas: sin ella el sistema no calcula la escala.</span>
            )}
            {puedeEditar && (
              <button onClick={abrir} className={claseBoton("secundario", "!py-1 !px-2")} title="Cargar o corregir la tabla de escalas">
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
            )}
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {editando
          ? "Desde qué nota LVS empieza cada escala (por ejemplo 4,88 para \u201c> 4,87\u201d). Debajo de la Escala 4 es la Escala 5: No cumple."
          : "La escala de cada mes y del trimestre sale de la nota Q4 – LVS con esta tabla. Escala 5 = No cumple."}
      </p>
    </Card>
  );
}

function TablaPosventa({
  trimestre,
  sucursal,
  meses,
  total,
  puedeEditar,
  onGuardado,
  onError,
  onRecargar,
}: {
  trimestre: Trimestre;
  sucursal: string;
  meses: Mes[];
  total: Total;
  puedeEditar: boolean;
  onGuardado: (mensaje: string) => Promise<void>;
  onError: (e: string | null) => void;
  /** Si algo falla a mitad de guardar: que la tabla muestre lo que de verdad quedó. */
  onRecargar: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<Record<string, FormMes>>({});
  const [formTrimestre, setFormTrimestre] = useState<Record<CampoNota, string>>({
    notaTrato: "",
    notaOrganizacion: "",
    notaCalidadReparacion: "",
    notaLvs: "",
  });
  const [guardando, setGuardando] = useState(false);

  function abrir() {
    setForm(
      Object.fromEntries(
        meses.map((m) => [m.periodo, Object.fromEntries(CAMPOS_MES.map((c) => [c, aTexto(m[c])])) as FormMes])
      )
    );
    setFormTrimestre(Object.fromEntries(CAMPOS_NOTA.map((c) => [c, aTexto(total[c])])) as Record<CampoNota, string>);
    setEditando(true);
  }

  async function guardar() {
    // Todo se valida ANTES de mandar nada: un error de tipeo en septiembre no puede
    // dejar julio y agosto guardados y septiembre no.
    const cambiosMeses: Array<{ periodo: string; datos: Partial<Record<CampoMes, number | null>> }> = [];
    for (const m of meses) {
      const datos: Partial<Record<CampoMes, number | null>> = {};
      for (const c of CAMPOS_MES_POSVENTA) {
        const esNota = (CAMPOS_NOTA as readonly string[]).includes(c);
        const r = leerCampo(form[m.periodo]?.[c] ?? "", esNota ? "nota" : "entero");
        if ("error" in r) {
          onError(`Revisá ${etiquetaMes(m.periodo)}, ${ETIQUETA_CAMPO[c]}: ${r.error} ("${form[m.periodo]?.[c]}").`);
          return;
        }
        if (r.valor !== m[c]) datos[c] = r.valor;
      }
      if (Object.keys(datos).length) cambiosMeses.push({ periodo: m.periodo, datos });
    }
    const notasTrimestre: Partial<Record<CampoNota, number | null>> = {};
    for (const c of CAMPOS_NOTA) {
      const r = leerCampo(formTrimestre[c], "nota");
      if ("error" in r) {
        onError(`Revisá ${ETIQUETA_NOTA[c].larga.split(":")[0]} del trimestre: ${r.error} ("${formTrimestre[c]}").`);
        return;
      }
      if (r.valor !== total[c]) notasTrimestre[c] = r.valor;
    }
    const cambiaTrimestre = Object.keys(notasTrimestre).length > 0;

    setGuardando(true);
    onError(null);
    try {
      for (const c of cambiosMeses) {
        await apiPutJson("/api/indicadores-cem/mes", { area: "POSVENTA", periodo: c.periodo, sucursal, ...c.datos });
      }
      if (cambiaTrimestre) {
        await apiPutJson("/api/indicadores-cem/trimestre", {
          area: "POSVENTA",
          anio: trimestre.anio,
          trimestre: trimestre.trimestre,
          sucursal,
          ...notasTrimestre,
        });
      }
      setEditando(false);
      await onGuardado(
        cambiosMeses.length || cambiaTrimestre
          ? `Indicadores de Posventa de ${sucursal} guardados.`
          : "No había cambios para guardar."
      );
    } catch (err) {
      const aviso =
        `${err instanceof Error ? err.message : "No se pudieron guardar los indicadores."} ` +
        "Lo que se llegó a guardar antes del error ya se ve en la tabla; revisá y volvé a guardar.";
      // Primero se recarga y después se avisa (ver TablaVentas).
      await onRecargar().catch(() => {});
      onError(aviso);
    } finally {
      setGuardando(false);
    }
  }

  const input = (valor: string, onCambio: (v: string) => void, etiqueta: string, decimal: boolean) => (
    <input
      value={valor}
      onChange={(e) => onCambio(e.target.value)}
      inputMode={decimal ? "decimal" : "numeric"}
      aria-label={etiqueta}
      className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right text-sm"
    />
  );
  const celdaMes = (periodo: string, campo: CampoMes) =>
    input(
      form[periodo]?.[campo] ?? "",
      (v) => setForm({ ...form, [periodo]: { ...form[periodo], [campo]: v } }),
      `${ETIQUETA_CAMPO[campo]} de ${etiquetaMes(periodo)}`,
      (CAMPOS_NOTA as readonly string[]).includes(campo)
    );

  const th = "px-2 py-2 text-right";
  const td = "whitespace-nowrap px-2 py-2 text-right tabular-nums";

  return (
    <Card padding="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
        <h3 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-navy">
          <Gauge className="h-4 w-4" aria-hidden="true" />
          {sucursal} · Q{trimestre.trimestre} {trimestre.anio}
          <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-navy">
            Posventa
          </span>
        </h3>
        {puedeEditar &&
          (editando ? (
            <div className="flex gap-2">
              <button onClick={guardar} disabled={guardando} className={claseBoton("primario", "!py-1.5")}>
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              <button onClick={() => setEditando(false)} className={claseBoton("secundario", "!py-1.5")}>
                Cancelar
              </button>
            </div>
          ) : (
            <button onClick={abrir} className={claseBoton("secundario", "!py-1.5")}>
              <Pencil className="h-4 w-4" /> Cargar / corregir
            </button>
          ))}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              <th className="px-4 py-2 text-left">Mes</th>
              <th className={th}>Mails enviados</th>
              <th className={th}>Encuestas efectivas</th>
              {CAMPOS_NOTA.map((c) => (
                <th key={c} className={th} title={ETIQUETA_NOTA[c].larga}>
                  {ETIQUETA_NOTA[c].corta}
                </th>
              ))}
              <th className="px-2 py-2 text-center" title="Sale de la nota Q4 – LVS con la tabla de objetivos">
                Escala
              </th>
              <th className="px-4 py-2 text-right" title="Encuestas efectivas sobre mails enviados">
                Tasa de respuesta
              </th>
            </tr>
          </thead>
          <tbody>
            {meses.map((m) => (
              <tr key={m.periodo} className="border-b border-gray-100">
                <td className="whitespace-nowrap px-4 py-2 font-medium text-ink">{etiquetaMes(m.periodo)}</td>
                {editando ? (
                  <>
                    <td className={td}>{celdaMes(m.periodo, "mailsEnviados")}</td>
                    <td className={td}>{celdaMes(m.periodo, "encuestasEfectivas")}</td>
                    {CAMPOS_NOTA.map((c) => (
                      <td key={c} className={td}>
                        {celdaMes(m.periodo, c)}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center">
                      <ChipEscala escala={m.escala} apagado />
                    </td>
                    <td className={`${td} pr-4 text-ink-muted`}>{fmtPct(m.tasaRespuesta)}</td>
                  </>
                ) : (
                  <>
                    <td className={td}>{fmtEntero(m.mailsEnviados)}</td>
                    <td className={td}>{fmtEntero(m.encuestasEfectivas)}</td>
                    {CAMPOS_NOTA.map((c) => (
                      <td key={c} className={`${td} ${c === "notaLvs" ? claseEscala(m.escala) : ""}`}>
                        {fmtDecimal(m[c])}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center">
                      <ChipEscala escala={m.escala} />
                    </td>
                    <td className={`${td} pr-4`}>{fmtPct(m.tasaRespuesta)}</td>
                  </>
                )}
              </tr>
            ))}
            <tr className="border-b border-gray-200 bg-gray-50 font-semibold text-ink">
              <td className="px-4 py-2">Total</td>
              <td className={td}>{fmtEntero(total.mailsEnviados)}</td>
              <td className={td}>{fmtEntero(total.encuestasEfectivas)}</td>
              {CAMPOS_NOTA.map((c) =>
                editando ? (
                  <td key={c} className={td}>
                    {input(
                      formTrimestre[c],
                      (v) => setFormTrimestre({ ...formTrimestre, [c]: v }),
                      `${ETIQUETA_NOTA[c].larga.split(":")[0]} del trimestre`,
                      true
                    )}
                  </td>
                ) : (
                  <td
                    key={c}
                    className={`${td} ${c === "notaLvs" ? claseEscala(total.escala) : ""}`}
                    title="La nota del trimestre que publica fábrica"
                  >
                    {fmtDecimal(total[c])}
                  </td>
                )
              )}
              <td className="px-2 py-2 text-center">
                <ChipEscala escala={total.escala} apagado={editando} />
              </td>
              <td className={`${td} pr-4`} title="Efectivas del trimestre sobre mails del trimestre, como en la planilla">
                {fmtPct(total.tasaRespuesta)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-xs text-ink-muted">
        {editando
          ? "Mails y encuestas en números enteros; las notas con decimales (4,86). Un casillero vacío queda sin dato. Las notas del Total son las del trimestre que publica fábrica."
          : "Las notas del Total son las del trimestre que publica fábrica (no el promedio de los meses). La tasa de respuesta es encuestas efectivas sobre mails enviados."}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------- área ----
/**
 * El cambio entre Ventas y Posventa (pedido del 18-09-2026: "tipo un botón que
 * cambie de posventa a ventas, con la estética cuidada").
 *
 * Es un control segmentado y no dos botones sueltos: se lee de un vistazo cuál de
 * las dos está elegida (la opción activa queda "levantada", en blanco sobre el
 * fondo gris) y no se confunde con las pestañas de trimestre de abajo, que usan
 * el estilo de botón del sistema. Con role="tablist" el lector de pantalla lo
 * anuncia como lo que es.
 */
function SelectorArea({ valor, onCambiar }: { valor: AreaCem; onCambiar: (a: AreaCem) => void }) {
  const opciones: Array<{ area: AreaCem; Icono: typeof Car; ayuda: string }> = [
    { area: "VENTAS", Icono: Car, ayuda: "Encuestas CEM de ventas (patentamientos)" },
    { area: "POSVENTA", Icono: Wrench, ayuda: "Encuestas CEM del taller (planilla de Posventa)" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Área"
      className="inline-flex rounded-xl bg-gray-100 p-1 ring-1 ring-inset ring-gray-200"
    >
      {opciones.map(({ area, Icono, ayuda }) => {
        const activa = area === valor;
        return (
          <button
            key={area}
            type="button"
            role="tab"
            aria-selected={activa}
            title={ayuda}
            onClick={() => onCambiar(area)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              activa ? "bg-white text-navy shadow-sm ring-1 ring-gray-200" : "text-ink-muted hover:bg-white/60 hover:text-ink"
            }`}
          >
            <Icono className={`h-4 w-4 ${activa ? "text-accent" : ""}`} aria-hidden="true" />
            {CONFIG_AREA[area].nombre}
          </button>
        );
      })}
    </div>
  );
}
