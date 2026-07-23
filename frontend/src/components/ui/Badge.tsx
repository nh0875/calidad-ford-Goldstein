import { ReactNode } from "react";

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

/**
 * Punto de color + etiqueta de texto visible (obligatoria: el ámbar no tiene
 * contraste suficiente por sí solo). El pulso lento SOLO se activa cuando el
 * caller pasa `pulsar` — pensado para ROJO con RQR abierto hace más de 3 días,
 * la condición se calcula afuera para no tocar lógica de negocio acá.
 */
export function PuntoSemaforo({
  semaforo,
  pulsar = false,
  soloIcono = false,
}: {
  semaforo: string | null | undefined;
  pulsar?: boolean;
  soloIcono?: boolean;
}) {
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
