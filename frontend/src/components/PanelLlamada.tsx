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
//
// TAMBIÉN SIRVE PARA CORREGIR. Esto se tipea apurado, mientras se habla por
// teléfono, así que equivocarse es normal. El panel se abre pidiendo lo que ya
// está cargado: si abriera en blanco, corregir una estrella obligaría a
// acordarse y volver a escribir todo el resto, y lo que no se vuelva a cargar
// se borra.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Phone, PhoneOff, Star } from "lucide-react";
import { ApiError, apiGet, apiPostJson } from "../lib/api";

export interface ItemPuntaje {
  item: string;
  etiqueta: string;
}

function Estrellas({ valor, onElegir }: { valor: number | null; onElegir: (n: number | null) => void }) {
  // Se pintan al pasar el mouse, antes de hacer clic: sin esto no hay forma de
  // saber qué va a quedar seleccionado hasta después de tocar, que es cuando ya
  // es tarde para cambiar de idea.
  const [encima, setEncima] = useState<number | null>(null);
  const marcadas = encima ?? valor ?? 0;

  return (
    <span className="inline-flex items-center gap-0.5" onMouseLeave={() => setEncima(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onElegir(n)}
          onMouseEnter={() => setEncima(n)}
          title={`${n} de 5`}
          aria-label={`Poner ${n} de 5`}
          className="rounded p-0.5 transition-transform duration-150 hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Star
            className={`h-4 w-4 transition-colors duration-150 ${n <= marcadas ? "fill-current text-amber-500" : "text-gray-300"}`}
          />
        </button>
      ))}
      {/* Hace falta poder DEJARLA VACÍA: si alguien se equivoca de estrella, sin
          esto no habría forma de volver a "sin calificar". */}
      {valor !== null && (
        <button
          type="button"
          onClick={() => onElegir(null)}
          className="ml-1 rounded px-1.5 py-0.5 text-[11px] text-ink-muted transition-colors hover:bg-gray-200 hover:text-ink"
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
  estado,
  puntajesPosventa,
  llamadaMotivo,
  onListo,
}: {
  casoId: string;
  area: string;
  /**
   * En qué estado está el caso. Decide qué dice el panel, que no es lo mismo en
   * los tres casos donde aparece:
   *   LLAMADA_PENDIENTE     — hay que llamarlo: es una tarea urgente.
   *   RESPONDIO_LLAMADA     — ya se cargó y esto es una corrección.
   *   NO_RESPONDE_CONTACTOS — se lo había dado por inalcanzable, y si al final
   *                           se lo pudo hablar el caso se reabre.
   */
  estado: string;
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
  // ¿Este caso ya se cerró por llamada y lo que se está haciendo es corregirlo?
  const corrigiendo = estado === "RESPONDIO_LLAMADA";
  // Urgente = todavía hay que levantar el teléfono. Los otros dos estados no lo
  // son: uno ya se resolvió y el otro ya se dio por cerrado.
  const urgente = estado === "LLAMADA_PENDIENTE";
  const [rqrAbierto, setRqrAbierto] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  // Lo que ya estaba cargado. Se pide siempre: en un caso que todavía no se
  // atendió vuelve vacío y el formulario queda en blanco, que es lo mismo que
  // antes, y así no hay dos caminos distintos según cómo se haya abierto.
  const traerLoCargado = useCallback(async () => {
    setCargando(true);
    try {
      const { data } = await apiGet<{
        data: {
          estrellasGeneral: number | null;
          comentario: string;
          puntajes: Array<{ item: string; estrellas: number | null }>;
          rqrAbierto: string | null;
        };
      }>(`/api/seguimiento/${encodeURIComponent(casoId)}/llamada`);
      setRqrAbierto(data.rqrAbierto);
      setGeneral(data.estrellasGeneral);
      setComentario(data.comentario);
      setPorItem(
        Object.fromEntries(
          data.puntajes.filter((x) => x.estrellas !== null).map((x) => [x.item, x.estrellas as number])
        )
      );
    } catch {
      // Que no se pueda leer lo anterior no tiene por qué impedir cargar: el
      // formulario queda en blanco y se avisa recién si falla el guardado.
    } finally {
      setCargando(false);
    }
  }, [casoId]);

  useEffect(() => {
    traerLoCargado();
  }, [traerLoCargado]);

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

  // Un caso ya cerrado no es una urgencia: se pinta en gris, no en rojo. El rojo
  // es para lo único que pide que alguien levante el teléfono ahora.
  const tono = urgente
    ? { borde: "border-red-200", fondo: "bg-red-50", texto: "text-red-900" }
    : { borde: "border-gray-200", fondo: "bg-gray-50", texto: "text-ink" };

  return (
    <div className={`border-b ${tono.borde} ${tono.fondo} px-4 py-3`}>
      <p className={`flex items-center gap-2 text-sm font-semibold ${tono.texto}`}>
        <Phone className="h-4 w-4 shrink-0" />
        {corrigiendo
          ? "Este caso se cerró por teléfono. Podés corregir lo que se cargó."
          : urgente
            ? "Hay que llamar a este cliente: no contestó ninguno de los dos WhatsApp."
            : "Este caso se cerró como “No responde contactos”. Si al final lo pudiste hablar, cargá acá lo que dijo."}
      </p>

      {llamadaMotivo && !corrigiendo && (
        <p className={`mt-1 text-xs ${urgente ? "text-red-800" : "text-ink-muted"}`}>
          Último intento: <span className="italic">{llamadaMotivo}</span>
        </p>
      )}

      <div className={`mt-3 rounded-lg border ${tono.borde} bg-white p-3 shadow-sm`}>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Lo que dijo por teléfono
        </div>

        {/* Cambiar la nota de un caso que ya abrió un reclamo formal no cierra
            ese reclamo: puede haber alguien trabajándolo. Se avisa acá, antes de
            tocar nada, porque después el cartel llega tarde. */}
        {corrigiendo && rqrAbierto && (
          <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Este caso tiene el <strong>{rqrAbierto}</strong> abierto. Si cambiás la calificación, el RQR no se cierra
              solo: revisalo desde la pantalla de RQR.
            </span>
          </p>
        )}

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
          className="mt-2 w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-sans text-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all duration-150 hover:bg-accent-dark hover:shadow disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {corrigiendo ? "Guardar los cambios" : "Guardar lo que dijo"}
          </button>

          {/* "No se pudo hablar" CIERRA el caso como "No responde contactos":
              se agotaron los tres intentos. Por eso el motivo es obligatorio —
              número equivocado, no atiende nunca y se negó a contestar son tres
              cosas distintas, y sin escribirlas quedan todas en la misma bolsa. */}
          {!urgente ? null : mostrarMotivo ? (
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="No atendió / número equivocado / no quiso contestar"
                className="min-w-[12rem] flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 font-sans text-xs transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
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
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-ink transition-all duration-150 hover:border-gray-400 hover:bg-gray-50"
              title="Cierra el caso como “No responde contactos”: se intentaron los tres contactos"
            >
              <PhoneOff className="h-3.5 w-3.5" />
              No se pudo hablar
            </button>
          )}
        </div>

        {cargando && <p className="mt-2 text-xs text-ink-muted">Buscando lo que ya estaba cargado…</p>}
        {falla && <p className="mt-2 text-xs text-red-700">{falla}</p>}
      </div>
    </div>
  );
}
