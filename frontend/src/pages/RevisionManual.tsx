import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, MessageSquare } from "lucide-react";
import { apiGet, apiPatchJson } from "../lib/api";
import { getUsuario, veTodasLasAreas } from "../lib/auth";
import { etiquetaArea, tonoArea } from "../lib/area";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";

// Bandeja de casos que la IA no pudo clasificar sola y necesitan que una persona
// decida el semáforo: respuestas por audio/imagen, reacciones ambiguas, o una
// primera respuesta demasiado corta. Acá Calidad ve cuáles son y los resuelve.

interface Analisis {
  id: string;
  resumenIA: string;
  analyzedAt: string;
  caso: {
    id: string;
    numeroOrden: string;
    nombrePropietario: string;
    modelo: string;
    asesor: string;
    sucursal: string;
    area: string;
    whatsapp: string;
    celular: string;
    tieneRqrAbierto: boolean;
  } | null;
  message: { content: string; createdAt: string } | null;
  rqr: { id: string; numeroRQR: string; estado: string } | null;
}

const SEMAFOROS: Array<{ valor: "VERDE" | "AMARILLO" | "ROJO"; etiqueta: string; clase: string }> = [
  { valor: "VERDE", etiqueta: "Verde", clase: "border-green-300 bg-green-50 text-green-800 hover:bg-green-100" },
  { valor: "AMARILLO", etiqueta: "Amarillo", clase: "border-yellow-300 bg-yellow-50 text-yellow-800 hover:bg-yellow-100" },
  { valor: "ROJO", etiqueta: "Rojo", clase: "border-red-300 bg-red-50 text-red-800 hover:bg-red-100" },
];

function fechaHora(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : iso;
}

export default function RevisionManual() {
  const [data, setData] = useState<Analisis[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const veTodas = veTodasLasAreas(getUsuario());

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await apiGet<{ data: Analisis[]; total: number }>("/api/sentiment-analysis/revision-manual");
      setData(r.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar la bandeja de revisión.");
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Clasificar a mano: fija el semáforo elegido y saca el caso de la bandeja.
  async function clasificar(analisis: Analisis, semaforo: "VERDE" | "AMARILLO" | "ROJO") {
    setGuardando(analisis.id);
    setError(null);
    try {
      await apiPatchJson(`/api/sentiment-analysis/${analisis.id}`, {
        semaforo,
        requiereRevisionManual: false,
      });
      setMensaje(
        `Clasificaste a ${analisis.caso?.nombrePropietario ?? "el cliente"} como ${semaforo.toLowerCase()}.` +
          (semaforo === "ROJO" ? " Si querés abrir un reclamo, hacelo desde RQR." : "")
      );
      // Se saca de la lista sin recargar todo
      setData((prev) => prev.filter((a) => a.id !== analisis.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar la clasificación.");
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div className="text-sm text-ink-muted">
            <p className="font-medium text-ink">Casos para clasificar a mano</p>
            <p className="mt-1">
              La IA no pudo clasificar sola estas respuestas: llegaron como audio o imagen, fueron una reacción
              ambigua, o dijeron muy poco. Leé lo que mandó el cliente y elegí el semáforo. Al clasificar, el caso
              sale de esta lista y cuenta en los reportes.
            </p>
          </div>
        </div>
      </Card>

      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}

      {data.length === 0 ? (
        <Card>
          <EmptyState
            icono={CheckCircle2}
            titulo="No hay casos para revisar"
            descripcion="Cuando la IA no pueda clasificar una respuesta, va a aparecer acá para que la mires."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            {data.length} {data.length === 1 ? "caso pendiente" : "casos pendientes"} de revisión (los más viejos
            primero).
          </p>
          {data.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{a.caso?.nombrePropietario ?? "Cliente sin caso"}</span>
                    {a.caso && (
                      <span className="text-xs text-ink-muted">
                        orden {a.caso.numeroOrden} · {a.caso.modelo} · {a.caso.sucursal}
                      </span>
                    )}
                    {veTodas && a.caso && (
                      <Badge tono={tonoArea(a.caso.area)} className="cursor-default">
                        {etiquetaArea(a.caso.area)}
                      </Badge>
                    )}
                    {a.caso?.tieneRqrAbierto && (
                      <Badge tono="rojo" className="cursor-default">
                        RQR abierto
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    Asesor: {a.caso?.asesor ?? "—"} · recibido {fechaHora(a.message?.createdAt ?? a.analyzedAt)}
                  </p>
                </div>
              </div>

              {/* Lo que efectivamente escribió/mandó el cliente */}
              <div className="mt-3 flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <p className="text-sm text-ink">{a.message?.content || a.resumenIA}</p>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-ink-muted">Clasificar como:</span>
                {SEMAFOROS.map((s) => (
                  <button
                    key={s.valor}
                    onClick={() => clasificar(a, s.valor)}
                    disabled={guardando === a.id}
                    className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${s.clase}`}
                  >
                    {s.etiqueta}
                  </button>
                ))}
                {guardando === a.id && <span className="text-xs text-ink-muted">Guardando…</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
