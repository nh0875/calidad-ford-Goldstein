// Alta manual de RQR: para reclamos que llegan por teléfono, en persona u
// otro canal fuera de WhatsApp. Se puede vincular un Caso existente
// (autocompletado) o cargar los datos del cliente a mano.
import { useEffect, useRef, useState } from "react";
import { getMarca } from "../lib/marca";
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
  // El cliente no quiso dar sus datos. Es OTRA cosa que "sin caso": ahí el
  // cliente existe y se carga a mano; acá directamente no se sabe quién es.
  const [anonimo, setAnonimo] = useState(false);
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

  // --- Campos propios del RQR de Volkswagen ---
  // El catálogo (áreas, subáreas y orígenes) lo manda el backend en /api/marca:
  // así el formulario no tiene una copia que se desactualice.
  const marca = getMarca();
  const rqrVW = marca.rqr?.porSubareas ?? false;
  const [tipoContacto, setTipoContacto] = useState("");
  // Sector responsable del reclamo. Es OTRO dato que el tipo de contacto: ese
  // dice por qué tema llamó el cliente, este de quién es el problema.
  const [areaPrincipal, setAreaPrincipal] = useState("");
  const [subarea, setSubarea] = useState("");
  const [origenRqr, setOrigenRqr] = useState("");
  const [codigoSucursal, setCodigoSucursal] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [tratamientoDadoPor2, setTratamientoDadoPor2] = useState("");
  // Las subáreas dependen del tipo de contacto elegido.
  const subareasDisponibles = marca.rqr?.areas.find((a) => a.valor === areaPrincipal)?.subareas ?? [];

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
        ...(casoElegido && !sinCaso && !anonimo ? { casoId: casoElegido.id } : {}),
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
        // Anónimo: NO va nombre (el backend rechaza anónimo + nombre juntos),
        // pero sí lo suelto que haya dejado y el área, porque tampoco hay caso.
        ...(anonimo
          ? {
              clienteAnonimo: true,
              telefonoManual: telefonoManual.trim() || undefined,
              modeloManual: modeloManual.trim() || undefined,
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
        // Campos de Volkswagen: se mandan solo si la marca los usa.
        ...(rqrVW
          ? {
              tipoContacto: tipoContacto || undefined,
              areaPrincipal: areaPrincipal || undefined,
              subarea: subarea || undefined,
              origenRqr: origenRqr || undefined,
              codigoSucursal: codigoSucursal.trim() || undefined,
              razonSocial: razonSocial.trim() || undefined,
              tratamientoDadoPor2: tratamientoDadoPor2.trim() || undefined,
            }
          : {}),
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
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={sinCaso}
                disabled={anonimo}
                onChange={(e) => {
                  setSinCaso(e.target.checked);
                  if (e.target.checked) setCasoElegido(null);
                }}
                className="h-4 w-4 accent-accent disabled:opacity-40"
              />
              Cliente sin caso en el sistema
            </label>
            {/* Anónimo: el cliente NO quiso identificarse. Apaga el otro
                casillero porque no hay datos que cargar a mano, y saca la
                exigencia del nombre. Solo en las marcas que lo habilitan. */}
            {marca.rqr?.clienteAnonimo && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={anonimo}
                  onChange={(e) => {
                    setAnonimo(e.target.checked);
                    if (e.target.checked) {
                      setCasoElegido(null);
                      setSinCaso(false);
                      setNombreManual("");
                    }
                  }}
                  className="h-4 w-4 accent-accent"
                />
                Cliente anónimo
              </label>
            )}
          </div>
        </div>

        {!sinCaso && !anonimo && !casoElegido && (
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

        {!sinCaso && !anonimo && casoElegido && (
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

        {/* ANÓNIMO: no hay nombre que cargar. Se dejan igual el teléfono y el
            modelo porque un reclamo anónimo puede traerlos (llamó de un número,
            o dijo qué auto tiene) y son lo único con lo que se lo puede ubicar
            después. Y sigue haciendo falta el área, porque tampoco hay caso. */}
        {anonimo && (
          <div className="space-y-3">
            <Alert tono="info">
              El cliente no quiso identificarse. El RQR se va a guardar como <strong>Anónimo</strong> — que es
              distinto de que falte el dato. Si te dio algún dato suelto, cargalo abajo.
            </Alert>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo etiqueta="Teléfono" hint="Si lo dejó o quedó registrado">
                <Input type="text" value={telefonoManual} onChange={(e) => setTelefonoManual(e.target.value)} />
              </Campo>
              <Campo etiqueta="Modelo del vehículo" hint="Si lo mencionó">
                <Input type="text" value={modeloManual} onChange={(e) => setModeloManual(e.target.value)} />
              </Campo>
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
          </div>
        )}
      </Card>

      {/* Clasificación de Volkswagen: tipo de contacto, subárea, origen y
          datos del concesionario. En Ford esta tarjeta no aparece. */}
      {rqrVW && (
        <Card padding="p-5">
          <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-navy">
            Clasificación y concesionario
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Campo etiqueta="Tipo de contacto" hint="Por qué tema se contactó">
              <Select value={tipoContacto} onChange={(e) => setTipoContacto(e.target.value)}>
                <option value="">(elegir)</option>
                {marca.rqr?.areas.map((a) => (
                  <option key={a.valor} value={a.valor}>
                    {a.etiqueta}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo etiqueta="Área principal" hint="Sector responsable del reclamo">
              <Select
                value={areaPrincipal}
                onChange={(e) => {
                  setAreaPrincipal(e.target.value);
                  // La subárea elegida puede no existir en el área nueva.
                  setSubarea("");
                }}
              >
                <option value="">(elegir)</option>
                {marca.rqr?.areas.map((a) => (
                  <option key={a.valor} value={a.valor}>
                    {a.etiqueta}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo
              etiqueta="Subárea"
              hint={areaPrincipal ? undefined : "Elegí primero el área principal"}
            >
              <Select
                value={subarea}
                onChange={(e) => setSubarea(e.target.value)}
                disabled={!areaPrincipal}
              >
                <option value="">(elegir)</option>
                {subareasDisponibles.map((s) => (
                  <option key={s.valor} value={s.valor}>
                    {s.etiqueta}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo etiqueta="Origen del reclamo" hint="Por dónde llegó">
              <Select value={origenRqr} onChange={(e) => setOrigenRqr(e.target.value)}>
                <option value="">(elegir)</option>
                {marca.rqr?.origenes.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo etiqueta="Código de sucursal" hint="4 caracteres">
              <Input
                type="text"
                value={codigoSucursal}
                maxLength={4}
                placeholder="0000"
                onChange={(e) => setCodigoSucursal(e.target.value)}
              />
            </Campo>
            <Campo etiqueta="Razón social">
              <Input type="text" value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} />
            </Campo>
          </div>
        </Card>
      )}

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
          {/* En las marcas que clasifican por área + subárea estos dos no van:
              el área principal ya dice el sector, y "área afectada" quedaba
              duplicando la subárea. En Ford siguen igual que siempre. */}
          {!rqrVW && (
            <>
              <Campo etiqueta="Área de origen">
                <Input type="text" value={areaOrigen} onChange={(e) => setAreaOrigen(e.target.value)} />
              </Campo>
              <Campo etiqueta="Área afectada">
                <Input type="text" value={areaAfectada} onChange={(e) => setAreaAfectada(e.target.value)} />
              </Campo>
            </>
          )}
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
          disabled={
            guardando ||
            !descripcion.trim() ||
            !asesor.trim() ||
            // Hay que saber de quién es: un caso, un nombre a mano, o la
            // constancia de que el cliente es anónimo.
            (!sinCaso && !anonimo && !casoElegido) ||
            (sinCaso && !nombreManual.trim())
          }
          className={claseBoton("primario")}
        >
          {guardando ? "Creando…" : "Crear RQR"}
        </button>
      </div>
    </div>
  );
}
