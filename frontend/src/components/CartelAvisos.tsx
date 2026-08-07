import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { Link } from "react-router-dom";
import { apiGet, apiPostJson } from "../lib/api";

// Cartel rojo de avisos. Va arriba de todo, en TODAS las pantallas, y no se
// puede ignorar por descuido: mientras haya un RQR sin atender o un cliente que
// escaló, el cartel sigue ahí. Reemplaza a la notificación por mail: el aviso
// vive adentro del sistema, que es donde se trabaja.
//
// Se apaga cuando alguien lo marca visto, o solo cuando se cierra el RQR.

interface Aviso {
  id: string;
  tipo: "RQR_ABIERTO" | "ESCALADO" | "AMARILLO_SIN_RQR" | "REVISION_MANUAL";
  titulo: string;
  detalle: string;
  creadoEn: string;
  casoId: string | null;
  rqrId: string | null;
  rqr: { numeroRQR: string; estado: string } | null;
  caso: { numeroOrden: string; nombrePropietario: string; asesor: string; sucursal: string } | null;
}

interface Respuesta {
  total: number;
  mostrados: number;
  data: Aviso[];
}

const ETIQUETA_TIPO: Record<Aviso["tipo"], string> = {
  RQR_ABIERTO: "RQR para tratar",
  ESCALADO: "El cliente empeoró",
  AMARILLO_SIN_RQR: "Amarillo para mirar",
  REVISION_MANUAL: "Para revisar a mano",
};

// Cada cuánto se vuelve a preguntar. 60 s alcanza: un RQR no es un chat.
const REFRESCO_MS = 60_000;

function haceCuanto(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const hs = Math.round(min / 60);
  if (hs < 24) return `hace ${hs} h`;
  return `hace ${Math.round(hs / 24)} d`;
}

export default function CartelAvisos() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  const cargar = useCallback(() => {
    apiGet<Respuesta>("/api/avisos")
      .then(setDatos)
      .catch(() => {
        /* si falla, el cartel no se muestra; no es bloqueante */
      });
  }, []);

  useEffect(() => {
    cargar();
    const id = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(id);
  }, [cargar]);

  async function marcarVisto(avisoId: string) {
    setTrabajando(true);
    try {
      await apiPostJson(`/api/avisos/${avisoId}/visto`, {});
      cargar();
    } catch {
      /* si falla, el aviso sigue: mejor que desaparezca sin haberse guardado */
    } finally {
      setTrabajando(false);
    }
  }

  async function marcarTodos() {
    setTrabajando(true);
    try {
      await apiPostJson("/api/avisos/vistos", {});
      setAbierto(false);
      cargar();
    } catch {
      /* idem */
    } finally {
      setTrabajando(false);
    }
  }

  if (!datos || datos.total === 0) return null;

  const uno = datos.total === 1;

  return (
    <div className="border-b border-red-200 bg-red-50">
      <div className="flex items-center gap-3 px-6 py-2.5">
        <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
        <p className="flex-1 text-sm text-red-900">
          <strong className="font-semibold">
            {uno ? "Hay 1 caso que necesita atención" : `Hay ${datos.total} casos que necesitan atención`}
          </strong>
          {!abierto && datos.data[0] && <span className="ml-2 text-red-800/80">— {datos.data[0].titulo}</span>}
        </p>
        <button
          onClick={() => setAbierto((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 transition-colors hover:bg-red-100"
        >
          {abierto ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              Ocultar
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              Ver {uno ? "el aviso" : "los avisos"}
            </>
          )}
        </button>
      </div>

      {abierto && (
        <div className="border-t border-red-200 bg-white/60 px-6 py-3">
          <ul className="space-y-2">
            {datos.data.map((a) => (
              <li
                key={a.id}
                className="flex items-start gap-3 rounded-md border border-red-200 bg-white px-3 py-2 text-sm"
              >
                <span className="mt-0.5 shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
                  {ETIQUETA_TIPO[a.tipo]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{a.titulo}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{a.detalle}</p>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    {haceCuanto(a.creadoEn)}
                    {a.caso && ` · orden ${a.caso.numeroOrden} · ${a.caso.sucursal}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.rqrId && (
                    <Link
                      to={`/rqr/${a.rqrId}`}
                      onClick={() => setAbierto(false)}
                      className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-700"
                    >
                      Abrir {a.rqr?.numeroRQR ?? "RQR"}
                    </Link>
                  )}
                  {!a.rqrId && a.casoId && a.tipo === "REVISION_MANUAL" && (
                    <Link
                      to={`/seguimiento?caso=${encodeURIComponent(`caso:${a.casoId}`)}`}
                      onClick={() => setAbierto(false)}
                      className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-accent-dark"
                    >
                      Abrir chat
                    </Link>
                  )}
                  {!a.rqrId && a.casoId && a.tipo !== "REVISION_MANUAL" && (
                    <Link
                      to="/casos"
                      onClick={() => setAbierto(false)}
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-gray-50"
                    >
                      Ver casos
                    </Link>
                  )}
                  <button
                    onClick={() => marcarVisto(a.id)}
                    disabled={trabajando}
                    title="Marcar este aviso como visto (no cierra el RQR)"
                    className="rounded-md p-1 text-ink-muted transition-colors hover:bg-gray-100 hover:text-ink disabled:opacity-40"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-ink-muted">
              {datos.total > datos.mostrados
                ? `Se muestran ${datos.mostrados} de ${datos.total}.`
                : "Un aviso se apaga solo cuando se cierra el RQR."}
            </p>
            <button
              onClick={marcarTodos}
              disabled={trabajando}
              className="inline-flex items-center gap-1 text-xs font-medium text-red-800 hover:underline disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Marcar todos como vistos
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
