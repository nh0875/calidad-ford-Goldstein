import { ReactNode } from "react";
import { Star } from "lucide-react";
import { usaEstrellas } from "../../lib/marca";

type Tono = "verde" | "amarillo" | "rojo" | "gris" | "azul" | "morado";

const TONOS: Record<Tono, string> = {
  verde: "bg-green-100 text-green-800",
  amarillo: "bg-yellow-100 text-yellow-800",
  rojo: "bg-red-100 text-red-800",
  gris: "bg-gray-200 text-gray-700",
  azul: "bg-accent-light text-accent-dark",
  morado: "bg-purple-100 text-purple-800",
};

export function Badge({
  children,
  tono = "gris",
  className = "",
  title,
}: {
  children: ReactNode;
  tono?: Tono;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONOS[tono]} ${className}`}
    >
      {children}
    </span>
  );
}

const SEMAFORO_COLOR: Record<string, string> = {
  VERDE: "bg-semaforo-verde",
  AMARILLO: "bg-semaforo-amarillo",
  ROJO: "bg-semaforo-rojo",
};
const SEMAFORO_LABEL: Record<string, string> = {
  VERDE: "Verde",
  AMARILLO: "Amarillo",
  ROJO: "Rojo",
};

// Color del puntaje: el 5 es el unico "todo bien" (en Volkswagen cualquier cosa
// por debajo de 5 abre RQR), asi que 5 va en verde, 4 y 3 en ambar y 2 y 1 en
// rojo. Coincide con el semaforo que el backend deriva del mismo puntaje.
function colorEstrellas(puntaje: number): string {
  if (puntaje >= 5) return "text-semaforo-verde";
  if (puntaje >= 3) return "text-semaforo-amarillo";
  return "text-semaforo-rojo";
}

/**
 * Puntaje de satisfaccion de 1 a 5 estrellas (Volkswagen). Se dibujan las cinco
 * siempre —las no obtenidas en gris— para que se lea de un vistazo cuanto falto,
 * y ademas se escribe "N/5": el color por si solo no alcanza para daltonicos ni
 * en una impresion en blanco y negro.
 */
export function Estrellas({
  puntaje,
  pulsar = false,
  soloIcono = false,
}: {
  puntaje: number;
  pulsar?: boolean;
  soloIcono?: boolean;
}) {
  const color = colorEstrellas(puntaje);
  return (
    <span
      className="inline-flex items-center gap-0.5"
      title={`Satisfaccion: ${puntaje} de 5 estrellas`}
      aria-label={`${puntaje} de 5 estrellas`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 ${
            n <= puntaje ? `${color} fill-current` : "text-gray-300"
          } ${pulsar && n <= puntaje ? "motion-safe:animate-pulse-soft" : ""}`}
        />
      ))}
      {!soloIcono && (
        <span className="ml-1 text-xs font-medium text-ink-muted">{puntaje}/5</span>
      )}
    </span>
  );
}

/**
 * Punto de color + etiqueta de texto visible (obligatoria: el ámbar no tiene
 * contraste suficiente por sí solo). El pulso lento SOLO se activa cuando el
 * caller pasa `pulsar` — pensado para ROJO con RQR abierto hace más de 3 días,
 * la condición se calcula afuera para no tocar lógica de negocio acá.
 */
export function PuntoSemaforo({
  semaforo,
  estrellas,
  pulsar = false,
  soloIcono = false,
}: {
  semaforo: string | null | undefined;
  /**
   * Puntaje 1-5. Solo lo mandan las pantallas de las marcas que miden por
   * estrellas (Volkswagen); si viene y la marca usa esa escala, se dibujan las
   * estrellas en lugar del punto de color. El semáforo se sigue recibiendo
   * porque en esas marcas se DERIVA del puntaje, y sirve de respaldo si un
   * análisis viejo todavía no tiene estrellas.
   */
  estrellas?: number | null;
  pulsar?: boolean;
  soloIcono?: boolean;
}) {
  if (usaEstrellas() && estrellas != null) {
    return <Estrellas puntaje={estrellas} pulsar={pulsar} soloIcono={soloIcono} />;
  }
  if (!semaforo) {
    return <span className="text-sm text-gray-300">—</span>;
  }
  const etiqueta = SEMAFORO_LABEL[semaforo] ?? semaforo;
  return (
    <span className="inline-flex items-center gap-1.5" title={`Semáforo: ${etiqueta}`}>
      <span
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${SEMAFORO_COLOR[semaforo] ?? "bg-gray-300"} ${
          pulsar ? "motion-safe:animate-pulse-soft" : ""
        }`}
      />
      {!soloIcono && <span className="text-xs font-medium text-ink-muted">{etiqueta}</span>}
    </span>
  );
}
