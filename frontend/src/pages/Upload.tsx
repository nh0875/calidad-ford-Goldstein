import { useMemo, useRef, useState } from "react";
import { getMarca } from "../lib/marca";
import { CheckCircle2, ClipboardList, FileSpreadsheet, ListChecks, UploadCloud } from "lucide-react";
import { apiPostForm, apiPostJson } from "../lib/api";
import { CAMPOS_CASO } from "../lib/camposCaso";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { Campo, Input } from "../components/ui/Field";
import UploadFord from "./UploadFord";

// ---------- Tipos que devuelve el backend ----------

interface HojaPreviewOk {
  nombre: string;
  ok: true;
  periodoSugerido: string | null;
  filaEncabezado: number;
  columnas: string[];
  mappingSugerido: Record<string, string>;
  kpisResumen: Record<string, number | string>;
  totalFilasDatos: number;
  preview: Array<Record<string, unknown>>;
}

interface HojaPreviewError {
  nombre: string;
  ok: false;
  error: string;
}

type HojaPreview = HojaPreviewOk | HojaPreviewError;

interface PreviewResponse {
  fileToken: string;
  filename: string;
  anio: number;
  hojas: HojaPreview[];
}

interface ResultadoHoja {
  hoja: string;
  periodo: string | null;
  ok: boolean;
  mensaje: string;
  totalFilas: number;
  insertados: number;
  duplicados: number;
  ordenesDuplicadas: string[];
  errores: Array<{ fila: number; motivo: string }>;
  historicosConSentimiento: number;
  semaforo: { VERDE: number; AMARILLO: number; ROJO: number };
  internosExcluidosDeWhatsapp: number;
}

interface ConfirmResponse {
  message: string;
  resultados: ResultadoHoja[];
  totales: {
    hojasImportadas: number;
    totalFilas: number;
    insertados: number;
    duplicados: number;
    conError: number;
    ordenesDuplicadas: string[];
    historicosConSentimiento: number;
    semaforo: { VERDE: number; AMARILLO: number; ROJO: number };
  };
}

// ---------- Estado por hoja en el paso 2 ----------

interface EstadoHoja {
  incluir: boolean;
  periodo: string;
  mapping: Record<string, string>;
}

const CLAVE_MAPPING_GUARDADO = "contactoPosterior.mappingColumnas";

function cargarMappingGuardado(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_MAPPING_GUARDADO) ?? "{}");
  } catch {
    return {};
  }
}

function formatearCelda(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  const texto = String(valor);
  // Las fechas llegan serializadas como ISO; se muestran cortas
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return texto.length > 40 ? `${texto.slice(0, 40)}…` : texto;
}

// ---------- Componente ----------

type Paso = "formulario" | "mapeo" | "resultado";

export default function Upload() {
  // Selector inicial de tipo de carga. "posventa" = flujo actual (intacto);
  // "ford" = flujo nuevo de encuesta oficial de Ford (Parte B).
  const [tipoCarga, setTipoCarga] = useState<"posventa" | "ventas" | "ford">("posventa");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap gap-2">
        <SelectorTipo activo={tipoCarga === "posventa"} onClick={() => setTipoCarga("posventa")} icono={UploadCloud} titulo="Contacto Posventa" descripcion="El Excel mensual de seguimiento post-servicio (área Posventa)." />
        <SelectorTipo activo={tipoCarga === "ventas"} onClick={() => setTipoCarga("ventas")} icono={UploadCloud} titulo="Contacto Ventas" descripcion="Mismo formato que Posventa; los casos quedan en el área Ventas." />
        <SelectorTipo
            activo={tipoCarga === "ford"}
            onClick={() => setTipoCarga("ford")}
            icono={ClipboardList}
            titulo={`Encuesta ${getMarca().nombre}`}
            descripcion={`El export de invitaciones de la plataforma de ${getMarca().nombre}.`}
          />
      </div>
      {tipoCarga === "ford" ? (
        <UploadFord />
      ) : (
        <UploadPosventa area={tipoCarga === "ventas" ? "VENTAS" : "POSVENTA"} />
      )}
    </div>
  );
}

function SelectorTipo({ activo, onClick, icono: Icono, titulo, descripcion }: { activo: boolean; onClick: () => void; icono: typeof UploadCloud; titulo: string; descripcion: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-start gap-3 rounded-xl border-2 bg-white p-4 text-left transition-colors ${
        activo ? "border-accent" : "border-gray-200 hover:border-gray-300"
      }`}
    >
      <Icono className={`h-5 w-5 shrink-0 ${activo ? "text-accent" : "text-ink-muted"}`} aria-hidden="true" />
      <div>
        <div className="font-semibold text-ink">{titulo}</div>
        <div className="text-xs text-ink-muted">{descripcion}</div>
      </div>
    </button>
  );
}

function UploadPosventa({ area = "POSVENTA" }: { area?: "POSVENTA" | "VENTAS" }) {
  const [paso, setPaso] = useState<Paso>("formulario");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Paso 1
  const [sucursal, setSucursal] = useState("");
  const [anio, setAnio] = useState(new Date().getFullYear());
  const inputArchivo = useRef<HTMLInputElement>(null);

  // Paso 2
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [hojasEstado, setHojasEstado] = useState<Record<string, EstadoHoja>>({});
  const [hojaActiva, setHojaActiva] = useState<string | null>(null);

  // Paso 3
  const [resultado, setResultado] = useState<ConfirmResponse | null>(null);

  const hojasOk = useMemo(
    () => (preview?.hojas.filter((h): h is HojaPreviewOk => h.ok) ?? []),
    [preview]
  );
  const hojaActivaData = hojasOk.find((h) => h.nombre === hojaActiva) ?? null;

  // ---------- Paso 1: subir archivo ----------

  async function subirArchivo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const archivo = inputArchivo.current?.files?.[0];
    if (!archivo) {
      setError("Elegí el archivo Excel (.xlsx o .xls) de Contacto Posterior para continuar.");
      return;
    }
    if (!sucursal.trim()) {
      setError("Indicá la sucursal (por ejemplo: San Juan).");
      return;
    }

    setCargando(true);
    try {
      const form = new FormData();
      form.append("archivo", archivo);
      form.append("anio", String(anio));
      const data = await apiPostForm<PreviewResponse>("/api/uploads", form);
      setPreview(data);

      const guardado = cargarMappingGuardado();
      const estadoInicial: Record<string, EstadoHoja> = {};
      for (const hoja of data.hojas) {
        if (!hoja.ok) continue;
        // El mapeo guardado de cargas anteriores pisa la sugerencia automática
        const mapping: Record<string, string> = {};
        for (const col of hoja.columnas) {
          mapping[col] = guardado[col] ?? hoja.mappingSugerido[col] ?? "descartar";
        }
        estadoInicial[hoja.nombre] = {
          incluir: true,
          periodo: hoja.periodoSugerido ?? "",
          mapping,
        };
      }
      setHojasEstado(estadoInicial);
      const primera = data.hojas.find((h) => h.ok);
      setHojaActiva(primera?.nombre ?? null);
      setPaso("mapeo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos leer el archivo. Verificá que sea un Excel válido (.xlsx o .xls).");
    } finally {
      setCargando(false);
    }
  }

  // ---------- Paso 2: mapeo ----------

  function cambiarMapping(hoja: string, columna: string, campo: string) {
    setHojasEstado((prev) => ({
      ...prev,
      [hoja]: { ...prev[hoja], mapping: { ...prev[hoja].mapping, [columna]: campo } },
    }));
  }

  function aplicarMappingATodas() {
    if (!hojaActiva) return;
    const origen = hojasEstado[hojaActiva].mapping;
    setHojasEstado((prev) => {
      const nuevo = { ...prev };
      for (const nombre of Object.keys(nuevo)) {
        if (nombre === hojaActiva) continue;
        const mapping: Record<string, string> = {};
        const columnas = hojasOk.find((h) => h.nombre === nombre)?.columnas ?? [];
        for (const col of columnas) {
          mapping[col] = origen[col] ?? nuevo[nombre].mapping[col] ?? "descartar";
        }
        nuevo[nombre] = { ...nuevo[nombre], mapping };
      }
      return nuevo;
    });
  }

  async function confirmar() {
    if (!preview) return;
    setError(null);

    const hojasAImportar = hojasOk
      .filter((h) => hojasEstado[h.nombre]?.incluir)
      .map((h) => ({
        nombre: h.nombre,
        periodo: hojasEstado[h.nombre].periodo || undefined,
        mapping: hojasEstado[h.nombre].mapping,
      }));

    if (hojasAImportar.length === 0) {
      setError("Elegí al menos una hoja (mes) para importar.");
      return;
    }

    setCargando(true);
    try {
      const data = await apiPostJson<ConfirmResponse>("/api/uploads/confirm", {
        fileToken: preview.fileToken,
        sucursal: sucursal.trim(),
        anio,
        area,
        hojas: hojasAImportar,
      });
      // Se guarda el mapeo para pre-completar la próxima carga
      localStorage.setItem(CLAVE_MAPPING_GUARDADO, JSON.stringify(hojasAImportar[0].mapping));
      setResultado(data);
      setPaso("resultado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos confirmar la carga. Probá de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  function reiniciar() {
    setPaso("formulario");
    setPreview(null);
    setHojasEstado({});
    setHojaActiva(null);
    setResultado(null);
    setError(null);
    if (inputArchivo.current) inputArchivo.current.value = "";
  }

  // ---------- Render ----------

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Pasos actual={paso} />

      {error && <Alert tono="error">{error}</Alert>}

      {paso === "formulario" && (
        <Card className="max-w-lg" padding="p-6">
          <form onSubmit={subirArchivo} className="space-y-4">
            <Campo etiqueta="Sucursal" hint="La sucursal no viene en el Excel: se aplica a todos los casos de esta carga.">
              <Input type="text" value={sucursal} onChange={(e) => setSucursal(e.target.value)} placeholder="Ej: San Juan" />
            </Campo>
            <Campo
              etiqueta="Año del archivo"
              hint={`Se combina con el nombre de cada hoja (ej: hoja "ENERO" + ${anio} → período ${anio}-01).`}
            >
              <Input
                type="number"
                value={anio}
                min={2000}
                max={2100}
                onChange={(e) => setAnio(Number(e.target.value))}
                className="w-40"
              />
            </Campo>
            <Campo etiqueta="Archivo Excel (.xlsx o .xls)" hint="Podés subir el archivo tal como lo descargás, sin borrar columnas ni convertirlo.">
              <input
                ref={inputArchivo}
                type="file"
                accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-navy file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-navy-dark"
              />
            </Campo>
            <button type="submit" disabled={cargando} className={claseBoton("primario")}>
              <UploadCloud className="h-4 w-4" aria-hidden="true" />
              {cargando ? "Leyendo el archivo…" : "Subir y revisar"}
            </button>
          </form>
        </Card>
      )}

      {paso === "mapeo" && preview && (
        <div className="space-y-6">
          <Card>
            <p className="text-sm text-ink-muted">
              Archivo <span className="font-medium text-ink">{preview.filename}</span> — encontramos{" "}
              <span className="font-medium text-ink">{preview.hojas.length}</span> hoja(s). Destildá las que no
              quieras importar y revisá los datos de resumen para confirmar que el archivo se leyó bien.
            </p>
          </Card>

          {/* Hojas detectadas con sus KPIs */}
          <div className="grid gap-4 md:grid-cols-2">
            {preview.hojas.map((hoja) =>
              hoja.ok ? (
                <div
                  key={hoja.nombre}
                  className={`rounded-xl border-2 bg-white p-4 shadow-sm transition-opacity ${
                    hojasEstado[hoja.nombre]?.incluir ? "border-accent/40" : "border-transparent opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={hojasEstado[hoja.nombre]?.incluir ?? false}
                        onChange={(e) =>
                          setHojasEstado((prev) => ({
                            ...prev,
                            [hoja.nombre]: { ...prev[hoja.nombre], incluir: e.target.checked },
                          }))
                        }
                        className="h-4 w-4 accent-accent"
                      />
                      <span className="font-semibold text-ink">{hoja.nombre}</span>
                    </label>
                    <span className="text-xs text-ink-muted">{hoja.totalFilasDatos} filas de datos</span>
                  </div>

                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <span className="text-ink-muted">Período:</span>
                    <input
                      type="text"
                      value={hojasEstado[hoja.nombre]?.periodo ?? ""}
                      onChange={(e) =>
                        setHojasEstado((prev) => ({
                          ...prev,
                          [hoja.nombre]: { ...prev[hoja.nombre], periodo: e.target.value },
                        }))
                      }
                      placeholder="AAAA-MM"
                      className="w-28 rounded border border-gray-300 px-2 py-1 text-sm focus:border-accent focus:outline-none"
                    />
                  </div>

                  {Object.keys(hoja.kpisResumen).length > 0 ? (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {Object.entries(hoja.kpisResumen).map(([kpi, valor]) => (
                        <div key={kpi} className="rounded bg-canvas px-2 py-1.5 text-center">
                          <div className="text-[11px] uppercase text-ink-muted">{kpi}</div>
                          <div className="text-sm font-semibold text-ink">{String(valor)}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-ink-muted">Esta hoja no tiene filas de resumen antes de la tabla.</p>
                  )}
                </div>
              ) : (
                <div key={hoja.nombre} className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                  <p className="font-semibold text-amber-800">{hoja.nombre}</p>
                  <p className="mt-1 text-sm text-amber-700">{hoja.error}</p>
                </div>
              )
            )}
          </div>

          {/* Mapeo de columnas + preview */}
          {hojaActivaData && (
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {hojasOk.map((h) => (
                    <button
                      key={h.nombre}
                      onClick={() => setHojaActiva(h.nombre)}
                      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                        h.nombre === hojaActiva ? "bg-navy font-medium text-white" : "bg-gray-100 text-ink-muted hover:bg-gray-200"
                      }`}
                    >
                      {h.nombre}
                    </button>
                  ))}
                </div>
                {hojasOk.length > 1 && (
                  <button onClick={aplicarMappingATodas} className={claseBoton("secundario", "!py-1.5")}>
                    Aplicar este mapeo a todas las hojas
                  </button>
                )}
              </div>

              <p className="mb-2 text-sm text-ink-muted">
                Debajo de cada columna del Excel, elegí a qué dato del sistema corresponde (la fila de títulos se
                encontró en la fila {hojaActivaData.filaEncabezado} de la hoja).
              </p>

              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      {hojaActivaData.columnas.map((col) => (
                        <th key={col} className="min-w-[180px] px-2 py-2 text-left align-top">
                          <div className="text-xs font-semibold text-ink" title={col}>
                            {col.length > 45 ? `${col.slice(0, 45)}…` : col}
                          </div>
                          <select
                            value={hojasEstado[hojaActivaData.nombre]?.mapping[col] ?? "descartar"}
                            onChange={(e) => cambiarMapping(hojaActivaData.nombre, col, e.target.value)}
                            className={`mt-1 w-full rounded border px-1 py-1 text-xs font-normal focus:outline-none ${
                              (hojasEstado[hojaActivaData.nombre]?.mapping[col] ?? "descartar") === "descartar"
                                ? "border-gray-200 text-gray-400"
                                : "border-accent/50 text-accent-dark"
                            }`}
                          >
                            {CAMPOS_CASO.map((campo) => (
                              <option key={campo.value} value={campo.value}>
                                {campo.label}
                              </option>
                            ))}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {hojaActivaData.preview.map((fila, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        {hojaActivaData.columnas.map((col) => (
                          <td key={col} className="whitespace-nowrap px-2 py-1.5 text-ink-muted">
                            {formatearCelda(fila[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="flex gap-3">
            <button onClick={reiniciar} className={claseBoton("fantasma", "border border-gray-300")}>
              Volver a empezar
            </button>
            <button onClick={confirmar} disabled={cargando} className={claseBoton("primario")}>
              {cargando ? "Importando casos…" : "Confirmar e importar"}
            </button>
          </div>
        </div>
      )}

      {paso === "resultado" && resultado && (
        <div className="space-y-6">
          <Alert tono="exito">{resultado.message}</Alert>

          {resultado.totales.ordenesDuplicadas.length > 0 && (
            <Alert tono="advertencia">
              <strong>
                {resultado.totales.ordenesDuplicadas.length} orden(es) ya existían y NO se cargaron.
              </strong>{" "}
              Un número de orden no puede repetirse: estas filas quedaron afuera. Revisá el archivo si creés que
              alguna debería haberse cargado.
              <div className="mt-1 break-words font-mono text-xs">
                {resultado.totales.ordenesDuplicadas.join(", ")}
              </div>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tarjeta titulo="Casos nuevos guardados" valor={resultado.totales.insertados} color="text-green-700" />
            <Tarjeta titulo="Ya existían (omitidos)" valor={resultado.totales.duplicados} color="text-ink-muted" />
            <Tarjeta titulo="Filas con problemas" valor={resultado.totales.conError} color="text-red-700" />
            <Tarjeta titulo="Históricos ya clasificados" valor={resultado.totales.historicosConSentimiento} color="text-accent-dark" />
          </div>

          <Card>
            <h3 className="mb-2 text-sm font-semibold text-ink">Semáforo de los casos históricos</h3>
            <div className="flex flex-wrap gap-3">
              <Badge tono="verde">Verdes: {resultado.totales.semaforo.VERDE}</Badge>
              <Badge tono="amarillo">Amarillos: {resultado.totales.semaforo.AMARILLO}</Badge>
              <Badge tono="rojo">Rojos: {resultado.totales.semaforo.ROJO}</Badge>
            </div>
          </Card>

          {resultado.resultados.map((r) => (
            <Card key={r.hoja}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-ink">
                  Hoja {r.hoja} {r.periodo ? `(${r.periodo})` : ""}
                </h3>
                <Badge tono={r.ok ? "verde" : "rojo"}>{r.ok ? "Importada" : "Con problemas"}</Badge>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{r.mensaje}</p>
              {r.internosExcluidosDeWhatsapp > 0 && (
                <p className="mt-1 text-xs text-ink-muted">
                  {r.internosExcluidosDeWhatsapp} caso(s) internos (INT) quedaron excluidos de los envíos de WhatsApp.
                </p>
              )}
              {r.ordenesDuplicadas.length > 0 && (
                <div className="mt-2 rounded bg-amber-50 p-3 text-xs text-amber-800">
                  <span className="font-medium">Órdenes repetidas (no cargadas):</span>{" "}
                  <span className="break-words font-mono">{r.ordenesDuplicadas.join(", ")}</span>
                </div>
              )}
              {r.errores.length > 0 && (
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded bg-red-50 p-3 text-xs text-red-700">
                  {r.errores.map((e, i) => (
                    <li key={i}>
                      Fila {e.fila}: {e.motivo}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}

          <button onClick={reiniciar} className={claseBoton("primario")}>
            Cargar otro archivo
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Piezas de UI ----------

function Pasos({ actual }: { actual: Paso }) {
  const pasos: Array<{ id: Paso; nombre: string; icono: typeof UploadCloud }> = [
    { id: "formulario", nombre: "1. Archivo y sucursal", icono: FileSpreadsheet },
    { id: "mapeo", nombre: "2. Hojas y columnas", icono: ListChecks },
    { id: "resultado", nombre: "3. Resultado", icono: CheckCircle2 },
  ];
  return (
    <div className="flex gap-2">
      {pasos.map((p) => (
        <div
          key={p.id}
          className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition-colors ${
            p.id === actual ? "bg-navy font-medium text-white" : "bg-gray-200 text-ink-muted"
          }`}
        >
          <p.icono className="h-3.5 w-3.5" aria-hidden="true" />
          {p.nombre}
        </div>
      ))}
    </div>
  );
}

function Tarjeta({ titulo, valor, color }: { titulo: string; valor: number; color: string }) {
  return (
    <Card>
      <div className="text-xs text-ink-muted">{titulo}</div>
      <div className={`font-display text-2xl font-bold ${color}`}>{valor}</div>
    </Card>
  );
}
