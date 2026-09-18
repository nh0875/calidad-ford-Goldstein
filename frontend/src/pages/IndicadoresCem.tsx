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
// Dos áreas desde el 18-09-2026: Ventas y Posventa, con un selector arriba. Las
// dos tienen las mismas columnas, cuentas y objetivos propios; en Posventa los
// "patentamientos" son las órdenes de reparación del taller y no hay separación
// tradicional / autoahorro (eso es de ventas).
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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

/** Lo que cambia de una área a otra: nombres de columnas y qué columnas hay. */
const CONFIG_AREA: Record<
  AreaCem,
  {
    nombre: string;
    /** Encabezado corto de la primera columna y su nombre completo (tooltip). */
    base: string;
    baseLargo: string;
    /** Tradicional / autoahorro: solo en Ventas. */
    conSeparacion: boolean;
    descripcion: string;
  }
> = {
  VENTAS: {
    nombre: "Ventas",
    base: "Patentam.",
    baseLargo: "patentamientos",
    conSeparacion: true,
    descripcion:
      "Patentamientos, base CEM, encuestas efectivas, mails válidos y OS de cada mes, por provincia.",
  },
  POSVENTA: {
    nombre: "Posventa",
    base: "Órdenes rep.",
    baseLargo: "órdenes de reparación",
    conSeparacion: false,
    descripcion:
      "Órdenes de reparación, base CEM, encuestas efectivas, mails válidos y OS de cada mes del taller, por provincia.",
  },
};

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

const CAMPOS_MES = [
  "patentamientos",
  "baseCem",
  "baseCemTradicional",
  "baseCemAutoahorro",
  "encuestasEfectivas",
  "baseSinDuplicados",
  "mailOk",
  "os",
] as const;
type CampoMes = (typeof CAMPOS_MES)[number];
type Cumple = boolean | null;

interface Mes extends Record<CampoMes, number | null> {
  periodo: string;
  porcentajeCarga: number | null;
  porcentajeEfectivas: number | null;
  porcentajeMailValidos: number | null;
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
}

interface Objetivos {
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

/** Qué campos se cargan en cada área (Posventa no separa tradicional / autoahorro). */
function camposDelArea(area: AreaCem): CampoMes[] {
  return CAMPOS_MES.filter((c) => CONFIG_AREA[area].conSeparacion || (c !== "baseCemTradicional" && c !== "baseCemAutoahorro"));
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
};

/**
 * Lee un casillero con los MISMOS límites que el backend. Así un error de tipeo (un
 * OS "489" por olvidar la coma) se frena antes de guardar, y no queda la mitad de
 * los meses guardados y la otra mitad no.
 */
function leerCampo(
  texto: string,
  tipo: "entero" | "os" | "porcentaje"
): { valor: number | null } | { error: string } {
  const n = leerNumero(texto, tipo === "entero");
  if (n === undefined) return { error: tipo === "entero" ? "tiene que ser un número entero" : "tiene que ser un número" };
  if (n === null) return { valor: null };
  if (tipo === "entero" && (n < 0 || n > 1_000_000)) return { error: "tiene que estar entre 0 y 1.000.000" };
  if (tipo === "os" && (n < 0 || n > 5)) return { error: "el OS va de 0 a 5" };
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

  const cargar = useCallback(async () => {
    try {
      setDatos(await apiGet<Respuesta>(`/api/indicadores-cem?anio=${anio}&area=${area}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar los indicadores.");
    }
  }, [anio, area]);

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

  // Solo se muestra si lo que llegó es del área elegida (el pedido puede volver
  // después de haber cambiado de área).
  const actual = useMemo(
    () => (datos && datos.area === area ? datos.trimestres.find((t) => t.trimestre === trimestre) ?? null : null),
    [datos, trimestre, area]
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
            <p className="mt-1 max-w-3xl text-sm text-ink-muted">
              {config.descripcion} Los números se cargan a mano; los porcentajes, los totales y la comparación con los
              objetivos los calcula el sistema.
            </p>
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

      {datos && actual && (
        <>
          <BloqueObjetivos
            key={`obj-${area}-${anio}-${trimestre}`}
            area={area}
            trimestre={actual}
            puedeEditar={datos.permisos.cargar && !datos.permisos.provincia}
            onGuardado={async (m) => {
              setMensaje(m);
              await cargar();
            }}
            onError={(e) => {
              setError(e);
              if (e) setMensaje(null);
            }}
          />
          {actual.sucursales.map((s) => (
            <TablaSucursal
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
              onGuardado={async (m) => {
                setMensaje(m);
                await cargar();
              }}
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

// ---------------------------------------------------------------- tabla ----
type FormMes = Record<CampoMes, string>;

function TablaSucursal({
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
  const config = CONFIG_AREA[area];
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
      onError(
        `${err instanceof Error ? err.message : "No se pudieron guardar los indicadores."} ` +
          "Lo que se llegó a guardar antes del error ya se ve en la tabla; revisá y volvé a guardar."
      );
      // Sin esto la tabla seguiría con los números viejos aunque algún mes ya se haya
      // guardado, y la próxima comparación de "qué cambió" saldría mal.
      await onRecargar().catch(() => {});
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
    { area: "POSVENTA", Icono: Wrench, ayuda: "Encuestas CEM de taller (órdenes de reparación)" },
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
