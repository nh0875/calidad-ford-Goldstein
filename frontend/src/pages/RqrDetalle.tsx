// Formulario de gestión del RQR: reproduce las secciones del formulario en
// papel que usa Calidad. Los datos del caso son solo lectura; el resto se
// edita y guarda con PATCH /api/rqr/:id.
import { useCallback, useEffect, useState } from "react";
import { getMarca } from "../lib/marca";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileDown, Trash2 } from "lucide-react";
import { apiDelete, apiDescargarArchivo, apiGet, apiPatchJson } from "../lib/api";
import { getUsuario } from "../lib/auth";
import { CATEGORIAS_CAUSA_RAIZ, etiquetaCategoria, fechaCorta } from "../lib/categorias";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge, PuntoSemaforo } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { Campo, Input, Select, Textarea } from "../components/ui/Field";
import { SkeletonBlock } from "../components/ui/Skeleton";
import { ConfirmarEliminacion } from "../components/ui/ConfirmarEliminacion";

interface RqrDetalleData {
  // --- Campos de Volkswagen (null en Ford) ---
  tipoContacto: string | null;
  areaPrincipal: string | null;
  subarea: string | null;
  origenRqr: string | null;
  codigoSucursal: string | null;
  razonSocial: string | null;
  tratamientoDadoPor2: string | null;
  creadoPor: { nombre: string } | null;
  id: string;
  numeroRQR: string;
  fechaApertura: string;
  canal: string;
  areaOrigen: string;
  areaAfectada: string | null;
  asesor: string;
  descripcionReclamo: string;
  tratamientoBitacora: string | null;
  solucionPropuesta: string | null;
  tratamientoDadoPor: string | null;
  fechaCierre: string | null;
  observaciones: string | null;
  responsableCierre: string | null;
  causaRaiz: string | null;
  estado: string;
  caso: {
    numeroOrden: string;
    nombrePropietario: string;
    whatsapp: string;
    celular: string;
    modelo: string;
    patente: string;
    chasisVIN: string | null;
    sucursal: string;
    fechaSalida: string | null;
    fechaProgramacion: string;
  } | null;
  nombreClienteManual: string | null;
  telefonoManual: string | null;
  modeloManual: string | null;
  sentimentAnalysis: {
    semaforo: string | null;
    estrellas: number | null;
    severidad: string | null;
    confianza: number;
    resumenIA: string;
    message: { content: string } | null;
  } | null;
}

const SEVERIDAD_TONO: Record<string, "gris" | "amarillo" | "rojo"> = {
  LEVE: "gris",
  MODERADA: "amarillo",
  GRAVE: "rojo",
};

interface Formulario {
  descripcionReclamo: string;
  tratamientoBitacora: string;
  solucionPropuesta: string;
  tratamientoDadoPor: string;
  tratamientoDadoPor2: string;
  causaRaiz: string;
  estado: string;
  responsableCierre: string;
  observaciones: string;
  areaOrigen: string;
  areaAfectada: string;
  areaPrincipal: string;
  subarea: string;
  fechaCierre: string; // AAAA-MM-DD o ""
}

function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default function RqrDetalle() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [rqr, setRqr] = useState<RqrDetalleData | null>(null);
  const [form, setForm] = useState<Formulario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const esAdmin = getUsuario()?.rol === "ADMIN";
  const [modalEliminar, setModalEliminar] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  async function eliminarRqr() {
    if (!rqr) return;
    setEliminando(true);
    setError(null);
    try {
      await apiDelete<{ message: string }>(`/api/rqr/${rqr.id}`);
      navigate("/rqr", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos eliminar el RQR.");
      setEliminando(false);
    }
  }

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const { data } = await apiGet<{ data: RqrDetalleData }>(`/api/rqr/${id}`);
      setRqr(data);
      setForm({
        descripcionReclamo: data.descripcionReclamo,
        tratamientoBitacora: data.tratamientoBitacora ?? "",
        solucionPropuesta: data.solucionPropuesta ?? "",
        tratamientoDadoPor: data.tratamientoDadoPor ?? "",
        tratamientoDadoPor2: data.tratamientoDadoPor2 ?? "",
        causaRaiz: data.causaRaiz ?? "",
        estado: data.estado,
        responsableCierre: data.responsableCierre ?? "",
        observaciones: data.observaciones ?? "",
        areaOrigen: data.areaOrigen,
        areaAfectada: data.areaAfectada ?? "",
        areaPrincipal: data.areaPrincipal ?? "",
        subarea: data.subarea ?? "",
        fechaCierre: data.fechaCierre ? data.fechaCierre.slice(0, 10) : "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar este RQR.");
    }
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar() {
    if (!form || !rqr) return;
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      const body = await apiPatchJson<{ message: string }>(`/api/rqr/${rqr.id}`, {
        descripcionReclamo: form.descripcionReclamo,
        tratamientoBitacora: form.tratamientoBitacora || null,
        solucionPropuesta: form.solucionPropuesta || null,
        tratamientoDadoPor: form.tratamientoDadoPor || null,
        tratamientoDadoPor2: form.tratamientoDadoPor2 || null,
        causaRaiz: form.causaRaiz || null,
        estado: form.estado,
        responsableCierre: form.responsableCierre || null,
        observaciones: form.observaciones || null,
        areaOrigen: form.areaOrigen,
        ...(rqrVW ? { areaPrincipal: form.areaPrincipal || undefined, subarea: form.subarea || undefined } : {}),
        areaAfectada: form.areaAfectada || null,
        // Al reabrir (estado != CERRADO) se limpia la fecha de cierre de forma
        // explícita: si no, el form conserva la fecha vieja y el RQR quedaría
        // "abierto" pero con fecha de cierre. Al cerrar sin fecha a mano se
        // omite el campo para que el backend la complete automáticamente.
        ...(form.estado === "CERRADO"
          ? form.fechaCierre
            ? { fechaCierre: form.fechaCierre }
            : {}
          : { fechaCierre: null }),
      });
      setMensaje(body.message);
      await cargar(); // refresca fechaCierre automática y estado
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar los cambios. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  async function exportarWord() {
    if (!rqr) return;
    setExportando(true);
    setError(null);
    try {
      await apiDescargarArchivo(`/api/rqr/${rqr.id}/word`, `${rqr.numeroRQR}.docx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos exportar este RQR.");
    } finally {
      setExportando(false);
    }
  }

  if (error && !rqr) {
    return (
      <div className="space-y-3">
        <Alert tono="error">{error}</Alert>
        <Link to="/rqr" className="inline-flex items-center gap-1 text-sm text-accent-dark hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver al listado
        </Link>
      </div>
    );
  }
  if (!rqr || !form) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <SkeletonBlock className="h-10 w-64" />
        <SkeletonBlock className="h-40 w-full" />
        <SkeletonBlock className="h-40 w-full" />
      </div>
    );
  }

  const set = (campo: keyof Formulario) => (v: string) => setForm({ ...form, [campo]: v });
  // Esta marca clasifica el RQR por área + subárea (Volkswagen).
  const rqrVW = getMarca().rqr.porSubareas;
  const semaforo = rqr.sentimentAnalysis?.semaforo ?? null;
  const pulsar = semaforo === "ROJO" && rqr.estado !== "CERRADO" && diasDesde(rqr.fechaApertura) > 3;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/rqr" className="inline-flex items-center gap-1 text-sm text-accent-dark hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Volver al listado
          </Link>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold text-ink">
            {rqr.numeroRQR}
            {semaforo && (
              <PuntoSemaforo
                semaforo={semaforo}
                estrellas={rqr.sentimentAnalysis?.estrellas ?? null}
                pulsar={pulsar}
                soloIcono
              />
            )}
          </h2>
          <p className="text-xs text-ink-muted">
            Abierto el {fechaCorta(rqr.fechaApertura)} · Canal {rqr.canal}
          </p>
        </div>
        <div className="flex gap-2">
          {esAdmin && (
            <button onClick={() => setModalEliminar(true)} className={claseBoton("peligro")} title="Eliminar RQR (borrado lógico, recuperable)">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Eliminar
            </button>
          )}
          <button onClick={exportarWord} disabled={exportando} className={claseBoton("secundario")}>
            <FileDown className="h-4 w-4" aria-hidden="true" />
            {exportando ? "Exportando…" : "Exportar a Word"}
          </button>
          <button onClick={guardar} disabled={guardando} className={claseBoton("primario")}>
            {guardando ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>

      {modalEliminar && (
        <ConfirmarEliminacion
          titulo="Eliminar RQR"
          descripcion={`Vas a eliminar ${rqr.numeroRQR}. Es un borrado lógico: deja de aparecer en el sistema pero queda recuperable desde la auditoría.`}
          palabra={rqr.numeroRQR}
          etiquetaAccion="Eliminar RQR"
          cargando={eliminando}
          onCancelar={() => setModalEliminar(false)}
          onConfirmar={eliminarRqr}
        />
      )}

      {mensaje && <Alert tono="exito">{mensaje}</Alert>}
      {error && <Alert tono="error">{error}</Alert>}

      {/* 1. Datos del cliente (solo lectura: del Caso vinculado, o manuales) */}
      <Seccion titulo={rqr.caso ? "1. Datos del cliente (del caso, solo lectura)" : "1. Datos del cliente (carga manual, sin caso en el sistema)"}>
        {rqr.caso ? (
          <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Dato etiqueta="Cliente" valor={rqr.caso.nombrePropietario} />
            <Dato etiqueta="Teléfono" valor={rqr.caso.whatsapp || rqr.caso.celular || "—"} />
            <Dato etiqueta="Vehículo" valor={`${rqr.caso.modelo} — ${rqr.caso.patente}${rqr.caso.chasisVIN ? ` — VIN ${rqr.caso.chasisVIN}` : ""}`} />
            <Dato etiqueta="N° de orden" valor={rqr.caso.numeroOrden} />
            <Dato etiqueta="Sucursal" valor={rqr.caso.sucursal} />
            <Dato etiqueta="Fecha del servicio" valor={fechaCorta(rqr.caso.fechaSalida ?? rqr.caso.fechaProgramacion)} />
          </div>
        ) : (
          <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <Dato etiqueta="Cliente" valor={rqr.nombreClienteManual ?? "(sin datos)"} />
            <Dato etiqueta="Teléfono" valor={rqr.telefonoManual ?? "—"} />
            <Dato etiqueta="Vehículo" valor={rqr.modeloManual ?? "—"} />
          </div>
        )}
        {/* Clasificación de Volkswagen. Se muestra solo si el RQR la tiene
            cargada: en Ford estos campos vienen vacíos y la fila no aparece. */}
        {(rqr.tipoContacto || rqr.areaPrincipal || rqr.origenRqr || rqr.codigoSucursal || rqr.razonSocial) && (
          <div className="mt-3 grid gap-x-6 gap-y-2 border-t border-gray-100 pt-3 text-sm sm:grid-cols-3">
            <Dato etiqueta="Tipo de contacto" valor={etiquetaCatalogo(rqr.tipoContacto, "area")} />
            <Dato etiqueta="Área principal" valor={etiquetaCatalogo(rqr.areaPrincipal, "area")} />
            <Dato etiqueta="Subárea" valor={etiquetaCatalogo(rqr.subarea, "subarea")} />
            <Dato etiqueta="Origen del reclamo" valor={etiquetaCatalogo(rqr.origenRqr, "origen")} />
            <Dato etiqueta="Código de sucursal" valor={rqr.codigoSucursal ?? "—"} />
            <Dato etiqueta="Razón social" valor={rqr.razonSocial ?? "—"} />
            <Dato etiqueta="Cargado por" valor={rqr.creadoPor?.nombre ?? "—"} />
          </div>
        )}
        {rqr.sentimentAnalysis && (
          <div className="mt-3 space-y-2">
            {(rqr.sentimentAnalysis.severidad || rqr.sentimentAnalysis.semaforo) && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                <span className="font-semibold uppercase">Análisis IA:</span>
                {rqr.sentimentAnalysis.severidad && (
                  <>
                    <span>severidad</span>
                    <Badge tono={SEVERIDAD_TONO[rqr.sentimentAnalysis.severidad] ?? "gris"}>
                      {rqr.sentimentAnalysis.severidad.toLowerCase()}
                    </Badge>
                  </>
                )}
                <span>· confianza {Math.round(rqr.sentimentAnalysis.confianza * 100)}%</span>
              </div>
            )}
            {rqr.sentimentAnalysis.message?.content && (
              <div className="rounded-md bg-canvas p-3 text-sm text-ink">
                <span className="text-xs font-semibold uppercase text-ink-muted">Respuesta original del cliente: </span>
                "{rqr.sentimentAnalysis.message.content}"
              </div>
            )}
          </div>
        )}
      </Seccion>

      {/* 2. Descripción del reclamo */}
      <Seccion titulo="2. Descripción del reclamo">
        <Textarea value={form.descripcionReclamo} onChange={(e) => set("descripcionReclamo")(e.target.value)} rows={6} />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Causa raíz (sugerida por IA, editable)">
            <Select value={form.causaRaiz} onChange={(e) => set("causaRaiz")(e.target.value)}>
              <option value="">(sin categoría)</option>
              {CATEGORIAS_CAUSA_RAIZ.map((c) => (
                <option key={c} value={c}>{etiquetaCategoria(c)}</option>
              ))}
            </Select>
          </Campo>
          {rqrVW ? (
            <>
              {/* El sector RESPONSABLE del reclamo. La subárea cuelga de acá, no
                  del tipo de contacto (que dice por qué tema llamó el cliente). */}
              <Campo etiqueta="Área principal" hint="Sector responsable del reclamo">
                <Select
                  value={form.areaPrincipal}
                  onChange={(e) => {
                    set("areaPrincipal")(e.target.value);
                    set("subarea")(""); // la subárea puede no existir en el área nueva
                  }}
                >
                  <option value="">(elegir)</option>
                  {getMarca().rqr.areas.map((a) => (
                    <option key={a.valor} value={a.valor}>{a.etiqueta}</option>
                  ))}
                </Select>
              </Campo>
              <Campo
                etiqueta="Subárea"
                hint={form.areaPrincipal ? undefined : "Elegí primero el área principal"}
              >
                <Select
                  value={form.subarea}
                  onChange={(e) => set("subarea")(e.target.value)}
                  disabled={!form.areaPrincipal}
                >
                  <option value="">(elegir)</option>
                  {(getMarca().rqr.areas.find((a) => a.valor === form.areaPrincipal)?.subareas ?? []).map((s) => (
                    <option key={s.valor} value={s.valor}>{s.etiqueta}</option>
                  ))}
                </Select>
              </Campo>
            </>
          ) : (
            <>
              <Campo etiqueta="Área de origen">
                <Input type="text" value={form.areaOrigen} onChange={(e) => set("areaOrigen")(e.target.value)} />
              </Campo>
              <Campo etiqueta="Área afectada">
                <Input type="text" value={form.areaAfectada} onChange={(e) => set("areaAfectada")(e.target.value)} />
              </Campo>
            </>
          )}
        </div>
      </Seccion>

      {/* 3. Tratamiento / bitácora */}
      <Seccion titulo="3. Tratamiento / Bitácora">
        <Textarea
          value={form.tratamientoBitacora}
          onChange={(e) => set("tratamientoBitacora")(e.target.value)}
          rows={5}
          placeholder="Registro cronológico del tratamiento del reclamo…"
        />
        {/* Dos casilleros: el tratamiento puede quedar a cargo de dos personas. */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Tratamiento dado por">
            <Input type="text" value={form.tratamientoDadoPor} onChange={(e) => set("tratamientoDadoPor")(e.target.value)} />
          </Campo>
          <Campo etiqueta="Tratamiento dado por (2)" hint="Si intervino una segunda persona">
            <Input type="text" value={form.tratamientoDadoPor2} onChange={(e) => set("tratamientoDadoPor2")(e.target.value)} />
          </Campo>
        </div>
      </Seccion>

      {/* 4. Solución propuesta */}
      <Seccion titulo="4. Solución propuesta">
        <Textarea
          value={form.solucionPropuesta}
          onChange={(e) => set("solucionPropuesta")(e.target.value)}
          rows={4}
          placeholder="Qué se le propuso al cliente para resolver el reclamo…"
        />
      </Seccion>

      {/* 5. Verificación de eficacia / cierre */}
      <Seccion titulo="5. Verificación de eficacia de la acción">
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Estado">
            <Select value={form.estado} onChange={(e) => set("estado")(e.target.value)}>
              <option value="ABIERTO">Abierto</option>
              <option value="EN_TRATAMIENTO">En tratamiento</option>
              <option value="CERRADO">Cerrado</option>
            </Select>
          </Campo>
          <Campo etiqueta="Responsable del cierre">
            <Input type="text" value={form.responsableCierre} onChange={(e) => set("responsableCierre")(e.target.value)} />
          </Campo>
          <Campo etiqueta="Fecha de cierre (automática al cerrar, editable)">
            <Input type="date" value={form.fechaCierre} onChange={(e) => set("fechaCierre")(e.target.value)} />
          </Campo>
        </div>
        <div className="mt-3">
          <Campo etiqueta="Observaciones">
            <Textarea value={form.observaciones} onChange={(e) => set("observaciones")(e.target.value)} rows={3} />
          </Campo>
        </div>
      </Seccion>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Card padding="p-5">
      <h3 className="mb-3 border-b border-gray-100 pb-2 font-display text-sm font-bold uppercase tracking-wide text-navy">
        {titulo}
      </h3>
      {children}
    </Card>
  );
}

/**
 * Traduce un código guardado (VTA_PRODUCTO, EMAIL…) a su etiqueta legible.
 * El catálogo lo manda el backend en /api/marca, así que la pantalla no tiene
 * una copia propia que se desactualice cuando Calidad cambie una redacción.
 */
function etiquetaCatalogo(valor: string | null, tipo: "area" | "subarea" | "origen"): string {
  if (!valor) return "—";
  const rqr = getMarca().rqr;
  if (tipo === "origen") return rqr.origenes.find((o) => o.valor === valor)?.etiqueta ?? valor;
  if (tipo === "area") return rqr.areas.find((a) => a.valor === valor)?.etiqueta ?? valor;
  for (const a of rqr.areas) {
    const s = a.subareas.find((x) => x.valor === valor);
    if (s) return s.etiqueta;
  }
  return valor;
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <span className="text-xs font-semibold uppercase text-ink-muted">{etiqueta}: </span>
      <span className="text-ink">{valor}</span>
    </div>
  );
}
