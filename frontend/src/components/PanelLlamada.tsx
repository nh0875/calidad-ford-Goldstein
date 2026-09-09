// ---------------------------------------------------------------------------
// Lo que hay que hacer cuando el cliente no contestó ninguno de los dos WhatsApp
// ---------------------------------------------------------------------------
//
// POR QUÉ ESTE PANEL ES OBLIGATORIO Y NO UN LUJO. El circuito automático mete
// casos en LLAMADA_PENDIENTE por su cuenta, y ningún otro lugar del sistema los
// puede sacar de ahí: la edición de casos no toca el estado de contacto. Sin
// esta pantalla, cada caso que llega a "hay que llamarlo" queda trabado para
// siempre y la lista crece sin que nadie pueda cerrarla.
//
// La calificación NO es obligatoria. Un cliente puede atender, decir que está
// todo bien y cortar sin dar un número: eso es una respuesta igual, y perderla
// por no tener puntaje sería peor que guardarla incompleta.

import { useState } from "react";
import { Check, Phone, PhoneOff, Star } from "lucide-react";
import { ApiError, apiPostJson } from "../lib/api";

export interface ItemPuntaje {
  item: string;
  etiqueta: string;
}

function Estrellas({ valor, onElegir }: { valor: number | null; onElegir: (n: number | null) => void }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onElegir(n)}
          title={`${n} de 5`}
          aria-label={`Poner ${n} de 5`}
          className="rounded p-0.5 transition-transform hover:scale-110"
        >
          <Star
            className={`h-4 w-4 ${valor !== null && n <= valor ? "fill-current text-amber-500" : "text-gray-300"}`}
          />
        </button>
      ))}
      {/* Hace falta poder DEJARLA VACÍA: si alguien se equivoca de estrella, sin
          esto no habría forma de volver a "sin calificar". */}
      {valor !== null && (
        <button
          type="button"
          onClick={() => onElegir(null)}
          className="ml-1 text-[11px] text-ink-muted hover:underline"
        >
          borrar
        </button>
      )}
    </span>
  );
}

export function PanelLlamada({
  casoId,
  area,
  puntajesPosventa,
  llamadaMotivo,
  onListo,
}: {
  casoId: string;
  area: string;
  puntajesPosventa: ItemPuntaje[] | null;
  llamadaMotivo?: string | null;
  onListo: () => Promise<void> | void;
}) {
  // Posventa se mide por ítems y Ventas con una nota sola. Es la misma división
  // que ya existe en la encuesta por WhatsApp: mezclarlas ensuciaría los
  // promedios por ítem con datos de un circuito que no los tiene.
  const porItems = area === "POSVENTA" && !!puntajesPosventa?.length;

  const [porItem, setPorItem] = useState<Record<string, number>>({});
  const [general, setGeneral] = useState<number | null>(null);
  const [comentario, setComentario] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [mostrarMotivo, setMostrarMotivo] = useState(false);

  async function guardar() {
    setGuardando(true);
    setFalla(null);
    try {
      const cuerpo: Record<string, unknown> = { comentario: comentario.trim() || null };
      if (porItems) {
        cuerpo.puntajes = (puntajesPosventa ?? []).map((i) => ({
          item: i.item,
          estrellas: porItem[i.item] ?? null,
          comentario: null,
        }));
      } else {
        cuerpo.estrellasGeneral = general;
      }
      await apiPostJson(`/api/seguimiento/${encodeURIComponent(casoId)}/llamada`, cuerpo);
      await onListo();
    } catch (err) {
      setFalla(err instanceof ApiError ? err.message : "No se pudo guardar el resultado de la llamada.");
    } finally {
      setGuardando(false);
    }
  }

  async function noSePudo() {
    if (!motivo.trim()) {
      setFalla("Contá por qué no se pudo hablar.");
      return;
    }
    setGuardando(true);
    setFalla(null);
    try {
      await apiPostJson(`/api/seguimiento/${encodeURIComponent(casoId)}/llamada-fallida`, {
        motivo: motivo.trim(),
      });
      await onListo();
    } catch (err) {
      setFalla(err instanceof ApiError ? err.message : "No se pudo anotar el intento.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="border-b border-red-200 bg-red-50 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-red-900">
        <Phone className="h-4 w-4 shrink-0" />
        Hay que llamar a este cliente: no contestó ninguno de los dos WhatsApp.
      </p>

      {llamadaMotivo && (
        <p className="mt-1 text-xs text-red-800">
          Último intento: <span className="italic">{llamadaMotivo}</span>
        </p>
      )}

      <div className="mt-3 rounded-md border border-red-200 bg-white p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Lo que dijo por teléfono
        </div>

        {porItems ? (
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {(puntajesPosventa ?? []).map((i) => (
              <div key={i.item} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-ink-muted">{i.etiqueta}</span>
                <Estrellas
                  valor={porItem[i.item] ?? null}
                  onElegir={(n) =>
                    setPorItem((prev) => {
                      const copia = { ...prev };
                      if (n === null) delete copia[i.item];
                      else copia[i.item] = n;
                      return copia;
                    })
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-3 text-xs">
            <span className="text-ink-muted">¿Cómo calificó la atención?</span>
            <Estrellas valor={general} onElegir={setGeneral} />
          </div>
        )}

        <textarea
          rows={2}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder="Lo que contó el cliente en la llamada."
          className="mt-2 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Guardar lo que dijo
          </button>

          {/* "No se pudo hablar" CIERRA el caso como "No responde contactos":
              se agotaron los tres intentos. Por eso el motivo es obligatorio —
              número equivocado, no atiende nunca y se negó a contestar son tres
              cosas distintas, y sin escribirlas quedan todas en la misma bolsa. */}
          {mostrarMotivo ? (
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="No atendió / número equivocado / no quiso contestar"
                className="min-w-[12rem] flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={noSePudo}
                disabled={guardando}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Anotar
              </button>
              <button
                type="button"
                onClick={() => setMostrarMotivo(false)}
                className="text-xs text-ink-muted hover:underline"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setMostrarMotivo(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-gray-50"
              title="Cierra el caso como “No responde contactos”: se intentaron los tres contactos"
            >
              <PhoneOff className="h-3.5 w-3.5" />
              No se pudo hablar
            </button>
          )}
        </div>

        {falla && <p className="mt-2 text-xs text-red-700">{falla}</p>}
      </div>
    </div>
  );
}
