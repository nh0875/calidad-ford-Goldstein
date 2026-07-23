// Carga de la encuesta oficial de Ford (Parte B). Mismo patrón que Contacto
// Posventa: subir → mapear columnas (con detección + sugerencia + localStorage)
// → confirmar → resumen del cruce y las tareas creadas, con herramienta para
// vincular a mano las filas que no cruzaron con ningún caso.
import { useRef, useState } from "react";
import { FileUp, Link2, SearchX } from "lucide-react";
import { apiGet, apiPostForm, apiPostJson } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";

const ETIQUETA_CAMPO: Record<string, string> = {
  idEncuesta: "ID encuesta",
  nombreCliente: "Nombre cliente",
  vin: "VIN",
  email: "Email",
  telefono: "Teléfono",
  estadoInvitacion: "Estado de la invitación",
  fechaRespuesta: "Fecha respuesta",
  ordenReparacion: "Orden de reparación",
  fechaSalidaTaller: "Fecha salida taller",
  asesorServicio: "Asesor de servicio",
  descartar: "(descartar)",
};

const CLAVE_MAPPING = "encuestaFord.mapping";

interface PreviewFord {
  fileToken: string;
  filename: string;
  filaEncabezado: number;
  columnas: string[];
  mappingSugerido: Record<string, string>;
  totalFilasDatos: number;
  preview: Array<Record<string, unknown>>;
  camposFord: string[];
}

interface SinMatch {
  numeroFilaExcel: number; nombreCliente: string; orden: string; vin: string; email: string; telefono: string; estado: string;
  area: string;
}
interface ConflictoArea {
  numeroFilaExcel: number; nombreCliente: string; orden: string;
  areaEncuesta: string; areaCaso: string; numeroOrdenCaso: string; detalle: string;
}
interface ResumenFord {
  uploadId: string;
  matcheados: number; respondidas: number;
  tareasNuevas: { RECORDAR_ENCUESTA: number; VERIFICAR_EMAIL: number };
  cerradasAuto: number; canceladasAuto: number; noElegibles: number; duplicados: number; sinAsignar: number;
  porCriterio: Record<string, number>;
  sinMatchear: SinMatch[];
  noReconocidos: { numeroFilaExcel: number; estado: string }[];
  hayUsuariosElegibles: boolean;
  porArea: Record<string, number>;
  sinMatchearPorArea: Record<string, number>;
  conflictosArea: ConflictoArea[];
  areaNoReconocida: Array<{ numeroFilaExcel: number; tipoEncuesta: string; motivo: string }>;
}

function formatearCelda(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return s.length > 32 ? s.slice(0, 32) + "…" : s;
}

export default function UploadFord() {
  const [paso, setPaso] = useState<"form" | "mapeo" | "resultado">("form");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<PreviewFord | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [resumen, setResumen] = useState<ResumenFord | null>(null);

  async function subir(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const archivo = inputArchivo.current?.files?.[0];
    if (!archivo) return setError("Elegí el Excel de invitaciones exportado de Ford (.xlsx).");
    setCargando(true);
    try {
      const form = new FormData();
      form.append("archivo", archivo);
      const data = await apiPostForm<PreviewFord>("/api/uploads/ford", form);
      setPreview(data);
      // Mapeo guardado pisa la sugerencia
      let guardado: Record<string, string> = {};
      try { guardado = JSON.parse(localStorage.getItem(CLAVE_MAPPING) ?? "{}"); } catch {}
      const m: Record<string, string> = {};
      for (const col of data.columnas) m[col] = guardado[col] ?? data.mappingSugerido[col] ?? "descartar";
      setMapping(m);
      setPaso("mapeo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos leer el archivo.");
    } finally {
      setCargando(false);
    }
  }

  async function confirmar() {
    if (!preview) return;
    setError(null);
    setCargando(true);
    try {
      // Solo se mandan las columnas con un campo real (no "descartar")
      const mapeoFinal: Record<string, string> = {};
      for (const [col, campo] of Object.entries(mapping)) if (campo && campo !== "descartar") mapeoFinal[col] = campo;
      const data = await apiPostJson<{ resumen: ResumenFord }>("/api/uploads/ford/confirm", {
        fileToken: preview.fileToken,
        mapping: mapeoFinal,
      });
      localStorage.setItem(CLAVE_MAPPING, JSON.stringify(mapping));
      setResumen(data.resumen);
      setPaso("resultado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos confirmar la importación.");
    } finally {
      setCargando(false);
    }
  }

  function reiniciar() {
    setPaso("form"); setPreview(null); setResumen(null); setError(null);
    if (inputArchivo.current) inputArchivo.current.value = "";
  }

  return (
    <div className="space-y-4">
      {error && <Alert tono="error">{error}</Alert>}

      {paso === "form" && (
        <Card className="max-w-lg" padding="p-6">
          <form onSubmit={subir} className="space-y-4">
            <p className="text-sm text-ink-muted">
              Subí el Excel de invitaciones que descargaste de la plataforma de Ford. El sistema cruza cada fila
              contra los casos existentes y arma las tareas de refuerzo para el equipo.
            </p>
            <input
              ref={inputArchivo}
              type="file"
              accept=".xlsx"
              className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-navy file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-navy-dark"
            />
            <button type="submit" disabled={cargando} className={claseBoton("primario")}>
              <FileUp className="h-4 w-4" aria-hidden="true" />
              {cargando ? "Leyendo…" : "Subir y revisar"}
            </button>
          </form>
        </Card>
      )}

      {paso === "mapeo" && preview && (
        <div className="space-y-4">
          <Card>
            <p className="text-sm text-ink-muted">
              Archivo <span className="font-medium text-ink">{preview.filename}</span> — {preview.totalFilasDatos} filas.
              Los encabezados se detectaron en la fila {preview.filaEncabezado}. Revisá el mapeo de columnas.
            </p>
          </Card>
          <Card padding="p-0" className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  {preview.columnas.map((col) => (
                    <th key={col} className="min-w-[150px] px-2 py-2 text-left align-top">
                      <div className="text-xs font-semibold text-ink" title={col}>{col.length > 28 ? col.slice(0, 28) + "…" : col}</div>
                      <select
                        value={mapping[col] ?? "descartar"}
                        onChange={(e) => setMapping((p) => ({ ...p, [col]: e.target.value }))}
                        className={`mt-1 w-full rounded border px-1 py-1 text-xs ${
                          (mapping[col] ?? "descartar") === "descartar" ? "border-gray-200 text-gray-400" : "border-accent/50 text-accent-dark"
                        }`}
                      >
                        {["descartar", ...preview.camposFord.filter((c) => c !== "descartar")].map((campo) => (
                          <option key={campo} value={campo}>{ETIQUETA_CAMPO[campo] ?? campo}</option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((fila, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    {preview.columnas.map((col) => (
                      <td key={col} className="whitespace-nowrap px-2 py-1.5 text-ink-muted">{formatearCelda(fila[col])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="flex gap-3">
            <button onClick={reiniciar} className={claseBoton("fantasma", "border border-gray-300")}>Volver a empezar</button>
            <button onClick={confirmar} disabled={cargando} className={claseBoton("primario")}>
              {cargando ? "Importando…" : "Confirmar e importar"}
            </button>
          </div>
        </div>
      )}

      {paso === "resultado" && resumen && (
        <ResultadoFord resumen={resumen} onReiniciar={reiniciar} />
      )}
    </div>
  );
}

function ResultadoFord({ resumen, onReiniciar }: { resumen: ResumenFord; onReiniciar: () => void }) {
  return (
    <div className="space-y-4">
      <Alert tono="exito">
        Importación terminada: {resumen.matcheados} casos cruzados, {resumen.respondidas} respondieron,{" "}
        {resumen.tareasNuevas.RECORDAR_ENCUESTA + resumen.tareasNuevas.VERIFICAR_EMAIL} tareas nuevas.
      </Alert>
      {!resumen.hayUsuariosElegibles && (
        <Alert tono="advertencia">No había empleados elegibles para el reparto: {resumen.sinAsignar} tarea(s) quedaron SIN asignar. Asignalas desde Refuerzos → Administración.</Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tarjeta t="Cruzados" v={resumen.matcheados} />
        <Tarjeta t="Respondieron" v={resumen.respondidas} color="text-green-700" />
        <Tarjeta t="Recordar encuesta" v={resumen.tareasNuevas.RECORDAR_ENCUESTA} color="text-accent-dark" />
        <Tarjeta t="Verificar email" v={resumen.tareasNuevas.VERIFICAR_EMAIL} color="text-amber-700" />
        <Tarjeta t="Cerradas auto." v={resumen.cerradasAuto} />
        <Tarjeta t="Canceladas auto." v={resumen.canceladasAuto} />
        <Tarjeta t="No elegibles" v={resumen.noElegibles} />
        <Tarjeta t="Duplicados omitidos" v={resumen.duplicados} />
        <Tarjeta t="Sin cruzar" v={resumen.sinMatchear.length} color="text-amber-700" />
        <Tarjeta t="No reconocidos" v={resumen.noReconocidos.length} />
      </div>

      <Card>
        <h3 className="mb-1 text-sm font-semibold text-ink">Cómo se cruzaron</h3>
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(resumen.porCriterio).map(([k, v]) => (
            <Badge key={k} tono="azul">{k}: {v}</Badge>
          ))}
          {Object.keys(resumen.porCriterio).length === 0 && <span className="text-ink-muted">—</span>}
        </div>
      </Card>

      {/* Desglose por área: del total clasificado y de las que no cruzaron */}
      <Card>
        <h3 className="mb-1 text-sm font-semibold text-ink">Desglose por área</h3>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tono="azul">Ventas: {resumen.porArea.VENTAS ?? 0}</Badge>
          <Badge tono="morado">Posventa: {resumen.porArea.POSVENTA ?? 0}</Badge>
          {resumen.areaNoReconocida.length > 0 && (
            <Badge tono="gris">Área no reconocida: {resumen.areaNoReconocida.length}</Badge>
          )}
        </div>
        {resumen.sinMatchear.length > 0 && (
          <p className="mt-2 text-xs text-ink-muted">
            De las {resumen.sinMatchear.length} sin cruzar: {resumen.sinMatchearPorArea.VENTAS ?? 0} de ventas,{" "}
            {resumen.sinMatchearPorArea.POSVENTA ?? 0} de posventa.
          </p>
        )}
      </Card>

      {resumen.conflictosArea.length > 0 && (
        <Card padding="p-0" className="overflow-hidden">
          <div className="border-b bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            Conflictos de área ({resumen.conflictosArea.length}) — no se creó tarea ni se tocó el caso
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 text-left uppercase text-ink-muted">
                <tr>
                  <th className="px-3 py-1.5">Fila</th>
                  <th className="px-3 py-1.5">Cliente</th>
                  <th className="px-3 py-1.5">Conflicto</th>
                </tr>
              </thead>
              <tbody>
                {resumen.conflictosArea.map((c) => (
                  <tr key={c.numeroFilaExcel} className="border-b border-gray-100">
                    <td className="px-3 py-1.5">{c.numeroFilaExcel}</td>
                    <td className="px-3 py-1.5">{c.nombreCliente}</td>
                    <td className="px-3 py-1.5 text-red-800">{c.detalle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {resumen.areaNoReconocida.length > 0 && (
        <Alert tono="advertencia">
          {resumen.areaNoReconocida.length} fila(s) con un tipo de encuesta que no permite deducir el área (no se creó
          tarea): revisá manualmente las filas{" "}
          {resumen.areaNoReconocida.slice(0, 10).map((n) => n.numeroFilaExcel).join(", ")}
          {resumen.areaNoReconocida.length > 10 ? "…" : ""}.
        </Alert>
      )}

      {resumen.sinMatchear.length > 0 && (
        <Card padding="p-0" className="overflow-hidden">
          <div className="border-b bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            Filas sin cruzar ({resumen.sinMatchear.length}) — vinculalas a mano si corresponde
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs uppercase text-ink-muted">
                  <th className="px-3 py-2">Fila</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Orden</th>
                  <th className="px-3 py-2">Área</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Vincular a un caso</th>
                </tr>
              </thead>
              <tbody>
                {resumen.sinMatchear.map((f) => (
                  <FilaSinMatch key={f.numeroFilaExcel} fila={f} uploadId={resumen.uploadId} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {resumen.noReconocidos.length > 0 && (
        <Alert tono="advertencia">
          {resumen.noReconocidos.length} fila(s) con un estado no reconocido (no se creó tarea): revisá manualmente las filas{" "}
          {resumen.noReconocidos.slice(0, 10).map((n) => n.numeroFilaExcel).join(", ")}
          {resumen.noReconocidos.length > 10 ? "…" : ""}.
        </Alert>
      )}

      <button onClick={onReiniciar} className={claseBoton("primario")}>Importar otro archivo</button>
    </div>
  );
}

function Tarjeta({ t, v, color = "text-ink" }: { t: string; v: number; color?: string }) {
  return (
    <Card padding="p-3">
      <div className="text-[11px] text-ink-muted">{t}</div>
      <div className={`font-display text-xl font-bold ${color}`}>{v}</div>
    </Card>
  );
}

interface CasoBuscado { id: string; numeroOrden: string; nombrePropietario: string; modelo: string; sucursal: string }

function FilaSinMatch({ fila, uploadId }: { fila: SinMatch; uploadId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState(fila.orden || fila.nombreCliente);
  const [resultados, setResultados] = useState<CasoBuscado[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const esBounce = /bounced/i.test(fila.estado);
  const tipo = esBounce ? "VERIFICAR_EMAIL" : "RECORDAR_ENCUESTA";

  async function buscar() {
    if (q.trim().length < 2) return;
    try {
      const { data } = await apiGet<{ data: CasoBuscado[] }>(`/api/casos/buscar?q=${encodeURIComponent(q.trim())}`);
      setResultados(data);
    } catch { setResultados([]); }
  }
  async function vincular(casoId: string) {
    setMsg(null);
    try {
      await apiPostJson("/api/refuerzos/vincular", { casoId, tipo, origenUploadId: uploadId });
      setMsg("✓ Caso vinculado y tarea creada");
      setAbierto(false);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo vincular");
    }
  }

  return (
    <>
      <tr className="border-b border-gray-100">
        <td className="px-3 py-2 text-ink-muted">{fila.numeroFilaExcel}</td>
        <td className="px-3 py-2 text-ink">{fila.nombreCliente || "—"}</td>
        <td className="px-3 py-2 text-ink-muted">{fila.orden || "—"}</td>
        <td className="px-3 py-2">
          <Badge tono={fila.area === "VENTAS" ? "azul" : "morado"}>{fila.area === "VENTAS" ? "Ventas" : "Posventa"}</Badge>
        </td>
        <td className="px-3 py-2"><Badge tono={esBounce ? "amarillo" : "gris"}>{fila.estado}</Badge></td>
        <td className="px-3 py-2">
          {msg ? (
            <span className="text-xs text-green-700">{msg}</span>
          ) : (
            <button onClick={() => setAbierto((a) => !a)} className="inline-flex items-center gap-1 text-xs font-medium text-accent-dark hover:underline">
              <Link2 className="h-3.5 w-3.5" /> Vincular
            </button>
          )}
        </td>
      </tr>
      {abierto && (
        <tr className="bg-canvas">
          <td colSpan={5} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && buscar()}
                placeholder="Buscar por nombre, orden, patente o teléfono…"
                className="w-72 rounded border border-gray-300 px-2 py-1 text-sm focus:border-accent focus:outline-none"
              />
              <button onClick={buscar} className={claseBoton("secundario", "!py-1")}>Buscar</button>
              <span className="text-xs text-ink-muted">Tarea: {tipo === "VERIFICAR_EMAIL" ? "Verificar email" : "Recordar encuesta"}</span>
            </div>
            {resultados.length > 0 && (
              <ul className="mt-2 divide-y divide-gray-100 rounded border border-gray-200 bg-white">
                {resultados.map((c) => (
                  <li key={c.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                    <span>{c.nombrePropietario} · #{c.numeroOrden} · {c.modelo} ({c.sucursal})</span>
                    <button onClick={() => vincular(c.id)} className="text-xs font-medium text-accent-dark hover:underline">Vincular acá</button>
                  </li>
                ))}
              </ul>
            )}
            {resultados.length === 0 && (
              <p className="mt-2 flex items-center gap-1 text-xs text-ink-muted"><SearchX className="h-3.5 w-3.5" /> Buscá un caso para vincular.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
