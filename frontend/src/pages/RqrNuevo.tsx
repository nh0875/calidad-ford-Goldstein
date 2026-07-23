// Alta manual de RQR: para reclamos que llegan por teléfono, en persona u
// otro canal fuera de WhatsApp. Se puede vincular un Caso existente
// (autocompletado) o cargar los datos del cliente a mano.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { apiGet, apiPostJson } from "../lib/api";
import { getUsuario, veTodasLasAreas } from "../lib/auth";
import { AREAS, etiquetaArea } from "../lib/area";
import { CATEGORIAS_CAUSA_RAIZ, etiquetaCategoria, fechaCorta } from "../lib/categorias";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { Campo, Input, Select, Textarea } from "../components/ui/Field";

interface CasoBusqueda {
  id: string;
  numeroOrden: string;
  nombrePropietario: string;
  whatsapp: string;
  celular: string;
  modelo: string;
  patente: string;
  sucursal: string;
  asesor: string;
  fechaProgramacion: string;
  tieneRqrAbierto: boolean;
}

export default function RqrNuevo() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const puedeElegirArea = veTodasLasAreas(getUsuario()); // ADMIN o usuario AMBAS

  // Vinculación con caso
  const [sinCaso, setSinCaso] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<CasoBusqueda[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [casoElegido, setCasoElegido] = useState<CasoBusqueda | null>(null);
  const timeoutBusqueda = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Datos manuales (cuando no hay caso)
  const [nombreManual, setNombreManual] = useState("");
  const [telefonoManual, setTelefonoManual] = useState("");
  const [modeloManual, setModeloManual] = useState("");

  // Campos del RQR
  const [canal, setCanal] = useState("Posventa");
  // Área de NEGOCIO del RQR (VENTAS/POSVENTA). Distinta de "área de origen"
  // (Taller/etc). Solo se elige cuando NO hay caso vinculado y el usuario ve
  // más de un área; si no, la define el caso o su propia área.
  const [areaNegocio, setAreaNegocio] = useState<"VENTAS" | "POSVENTA">("POSVENTA");
  const [areaOrigen, setAreaOrigen] = useState("Taller");
  const [areaAfectada, setAreaAfectada] = useState("");
  const [asesor, setAsesor] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [causaRaiz, setCausaRaiz] = useState("");
  const [bitacora, setBitacora] = useState("");
  const [observaciones, setObservaciones] = useState("");

  // Autocompletado con debounce
  useEffect(() => {
    if (timeoutBusqueda.current) clearTimeout(timeoutBusqueda.current);
    if (sinCaso || casoElegido || busqueda.trim().length < 2) {
      setResultados([]);
      return;
    }
    timeoutBusqueda.current = setTimeout(async () => {
      setBuscando(true);
      try {
        const { data } = await apiGet<{ data: CasoBusqueda[] }>(
          `/api/casos/buscar?q=${encodeURIComponent(busqueda.trim())}`
        );
        setResultados(data);
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => {
      if (timeoutBusqueda.current) clearTimeout(timeoutBusqueda.current);
    };
  }, [busqueda, sinCaso, casoElegido]);

  function elegirCaso(caso: CasoBusqueda) {
    setCasoElegido(caso);
    setResultados([]);
    setBusqueda("");
    if (!asesor) setAsesor(caso.asesor);
  }

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      const { data } = await apiPostJson<{ message: string; data: { id: string } }>("/api/rqr", {
        ...(casoElegido && !sinCaso ? { casoId: casoElegido.id } : {}),
        ...(sinCaso
          ? {
              nombreClienteManual: nombreManual.trim() || undefined,
              telefonoManual: telefonoManual.trim() || undefined,
              modeloManual: modeloManual.trim() || undefined,
              // Sin caso vinculado el área se elige acá. El backend ignora esto
              // para usuarios restringidos (les fuerza la suya) y cuando hay caso
              // (hereda la del caso).
              area: areaNegocio,
            }
          : {}),
        canal: canal.trim() || "Posventa",
        areaOrigen: areaOrigen.trim() || "Taller",
        areaAfectada: areaAfectada.trim() || undefined,
        asesor: asesor.trim(),
        descripcionReclamo: descripcion.trim(),
        causaRaiz: causaRaiz || undefined,
        tratamientoBitacora: bitacora.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
      });
      navigate(`/rqr/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear el RQR. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link to="/rqr" className="inline-flex items-center gap-1 text-sm text-accent-dark hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver al listado
        </Link>
        <h2 className="font-display text-xl font-bold text-ink">Nuevo RQR (carga manual)</h2>
        <p className="text-xs text-ink-muted">
          Para reclamos que llegan por teléfono, en persona u otro canal. El número correlativo se genera solo.
        </p>
      </div>

      {error && <Alert tono="error">{error}</Alert>}

      {/* Cliente: caso vinculado o datos manuales */}
      <Card padding="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy">1. Cliente</h3>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={sinCaso}
              onChange={(e) => {
                setSinCaso(e.target.checked);
                if (e.target.checked) setCasoElegido(null);
              }}
              className="h-4 w-4 accent-accent"
            />
            Cliente sin caso en el sistema
          </label>
        </div>

        {!sinCaso && !casoElegido && (
          <div className="relative">
            <Input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar caso por nombre, teléfono, patente o número de orden…"
            />
            {buscando && <p className="mt-1 text-xs text-ink-muted">Buscando…</p>}
            {resultados.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                {resultados.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => elegirCaso(c)}
                      className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent-light"
                    >
                      <span className="font-medium text-ink">{c.nombrePropietario}</span>
                      <span className="ml-2 text-ink-muted">
                        {c.modelo} · {c.patente} · Orden {c.numeroOrden} · {fechaCorta(c.fechaProgramacion)}
                      </span>
                      {c.tieneRqrAbierto && (
                        <Badge tono="rojo" className="ml-2">
                          ya tiene RQR abierto
                        </Badge>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!buscando && busqueda.trim().length >= 2 && resultados.length === 0 && (
              <p className="mt-1 text-xs text-ink-muted">
                No encontramos ese caso. Si el cliente no está en el sistema, tildá "Cliente sin caso".
              </p>
            )}
          </div>
        )}

        {!sinCaso && casoElegido && (
          <div className="flex items-start justify-between rounded-md bg-accent-light p-3 text-sm">
            <div>
              <div className="font-medium text-ink">{casoElegido.nombrePropietario}</div>
              <div className="text-ink-muted">
                {casoElegido.modelo} · {casoElegido.patente} · Orden {casoElegido.numeroOrden} ·{" "}
                {casoElegido.sucursal} · Tel {casoElegido.whatsapp || casoElegido.celular || "—"}
              </div>
            </div>
            <button onClick={() => setCasoElegido(null)} className="text-xs text-accent-dark hover:underline">
              Cambiar
            </button>
          </div>
        )}

        {sinCaso && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo etiqueta="Nombre del cliente *">
              <Input type="text" value={nombreManual} onChange={(e) => setNombreManual(e.target.value)} />
            </Campo>
            <Campo etiqueta="Teléfono">
              <Input type="text" value={telefonoManual} onChange={(e) => setTelefonoManual(e.target.value)} />
            </Campo>
            <Campo etiqueta="Modelo del vehículo">
              <Input type="text" value={modeloManual} onChange={(e) => setModeloManual(e.target.value)} />
            </Campo>
            {/* Sin caso vinculado no hay de dónde heredar el área: la elige quien
                ve más de un área. A los restringidos el backend les fuerza la suya. */}
            {puedeElegirArea && (
              <Campo etiqueta="Área del reclamo *" hint="No hay caso vinculado del cual heredarla">
                <Select
                  value={areaNegocio}
                  onChange={(e) => setAreaNegocio(e.target.value as "VENTAS" | "POSVENTA")}
                >
                  {AREAS.map((a) => (
                    <option key={a} value={a}>
                      {etiquetaArea(a)}
                    </option>
                  ))}
                </Select>
              </Campo>
            )}
          </div>
        )}
      </Card>

      {/* Datos del reclamo */}
      <Card padding="p-5">
        <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-navy">2. Reclamo</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo etiqueta="Canal">
            <Select value={canal} onChange={(e) => setCanal(e.target.value)}>
              <option>Posventa</option>
              <option>Teléfono</option>
              <option>Presencial</option>
              <option>E-mail</option>
              <option>Otro</option>
            </Select>
          </Campo>
          <Campo etiqueta="Área de origen">
            <Input type="text" value={areaOrigen} onChange={(e) => setAreaOrigen(e.target.value)} />
          </Campo>
          <Campo etiqueta="Área afectada">
            <Input type="text" value={areaAfectada} onChange={(e) => setAreaAfectada(e.target.value)} />
          </Campo>
          <Campo etiqueta="Asesor *">
            <Input type="text" value={asesor} onChange={(e) => setAsesor(e.target.value)} />
          </Campo>
        </div>
        <div className="mt-3">
          <Campo etiqueta="Descripción del reclamo *">
            <Textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={5}
              placeholder="Qué reclama el cliente, cuándo pasó, qué espera…"
            />
          </Campo>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Causa raíz (si ya se conoce)">
            <Select value={causaRaiz} onChange={(e) => setCausaRaiz(e.target.value)}>
              <option value="">(sin categoría)</option>
              {CATEGORIAS_CAUSA_RAIZ.map((c) => (
                <option key={c} value={c}>{etiquetaCategoria(c)}</option>
              ))}
            </Select>
          </Campo>
          <Campo etiqueta="Primer registro de bitácora (opcional)">
            <Input type="text" value={bitacora} onChange={(e) => setBitacora(e.target.value)} />
          </Campo>
        </div>
        <div className="mt-3">
          <Campo etiqueta="Observaciones (opcional)">
            <Textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2} />
          </Campo>
        </div>
      </Card>

      <div className="flex justify-end gap-3">
        <Link to="/rqr" className={claseBoton("fantasma", "border border-gray-300")}>
          Cancelar
        </Link>
        <button
          onClick={guardar}
          disabled={guardando || !descripcion.trim() || !asesor.trim() || (!sinCaso && !casoElegido) || (sinCaso && !nombreManual.trim())}
          className={claseBoton("primario")}
        >
          {guardando ? "Creando…" : "Crear RQR"}
        </button>
      </div>
    </div>
  );
}
