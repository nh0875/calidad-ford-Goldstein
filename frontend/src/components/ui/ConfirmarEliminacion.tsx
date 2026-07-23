import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { claseBoton } from "./Button";

/**
 * Modal de confirmación REFORZADA para acciones destructivas: no alcanza con un
 * "¿estás seguro?", hay que escribir una palabra exacta (ej. el número de orden
 * o "ELIMINAR") para habilitar el botón. Evita borrados por reflejo o por clic
 * accidental.
 */
export function ConfirmarEliminacion({
  titulo,
  descripcion,
  palabra,
  etiquetaAccion = "Eliminar",
  cargando = false,
  onCancelar,
  onConfirmar,
}: {
  titulo: string;
  descripcion: string;
  palabra: string; // texto exacto que hay que tipear para habilitar
  etiquetaAccion?: string;
  cargando?: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const habilitado = texto.trim() === palabra && !cargando;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl motion-safe:animate-fade-slide-in">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-red-700">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          {titulo}
        </h3>
        <p className="mt-3 text-sm text-ink-muted">{descripcion}</p>
        <p className="mt-3 text-sm text-ink">
          Para confirmar, escribí{" "}
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono font-semibold text-ink">{palabra}</span>:
        </p>
        <input
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && habilitado) onConfirmar();
          }}
          className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          placeholder={palabra}
        />
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onCancelar} disabled={cargando} className={claseBoton("fantasma", "border border-gray-300")}>
            Cancelar
          </button>
          <button onClick={onConfirmar} disabled={!habilitado} className={claseBoton("peligro")}>
            {cargando ? "Eliminando…" : etiquetaAccion}
          </button>
        </div>
      </div>
    </div>
  );
}
