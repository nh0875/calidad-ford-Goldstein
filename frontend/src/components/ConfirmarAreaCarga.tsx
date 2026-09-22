// Ventana de confirmación antes de importar un Excel de Contacto (22-09-2026).
//
// Pedido de Calidad: que antes de cargar "te explote en la pantalla" la pregunta
// "¿Estás seguro de cargar en tal área?", para que sí o sí se lea y se piense si
// el archivo va en Ventas o en Posventa. Un Excel cargado en el área equivocada
// no da error: los casos quedan del otro lado y nadie los ve donde los busca.
//
// Por eso:
//  - el área va enorme, con su color y su ícono, y el texto dice qué hacer si no
//    es esa;
//  - el botón que sale enfocado es CANCELAR: un Enter de reflejo no carga nada;
//  - el de cargar se habilita recién a los pocos segundos, con la cuenta a la
//    vista, así no se confirma sin haberla leído.
import { useEffect, useId, useState } from "react";
import { Car, FileSpreadsheet, Wrench } from "lucide-react";
import { claseBoton } from "./ui/Button";

export type AreaCarga = "POSVENTA" | "VENTAS";

const SEGUNDOS_PARA_LEER = 3;

const ESTILO: Record<AreaCarga, { nombre: string; otra: string; Icono: typeof Car; franja: string; chip: string }> = {
  POSVENTA: {
    nombre: "Posventa",
    otra: "Ventas",
    Icono: Wrench,
    franja: "bg-teal-600",
    chip: "bg-teal-50 text-teal-800 ring-teal-200",
  },
  VENTAS: {
    nombre: "Ventas",
    otra: "Posventa",
    Icono: Car,
    franja: "bg-indigo-600",
    chip: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  },
};

export function ConfirmarAreaCarga({
  area,
  archivo,
  sucursal,
  meses,
  filas,
  cargando = false,
  onCancelar,
  onConfirmar,
}: {
  area: AreaCarga;
  archivo: string;
  sucursal: string;
  /** Los meses (hojas) que se van a importar, como se muestran. */
  meses: string[];
  /** Filas de datos en total, de las hojas elegidas. */
  filas: number;
  cargando?: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const e = ESTILO[area];
  const idTitulo = useId();
  const idTexto = useId();
  const [faltan, setFaltan] = useState(SEGUNDOS_PARA_LEER);

  useEffect(() => {
    if (faltan <= 0) return;
    const t = setTimeout(() => setFaltan((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [faltan]);

  // Escape = cancelar (salvo que ya esté importando: ahí no hay vuelta atrás).
  useEffect(() => {
    function tecla(ev: KeyboardEvent) {
      if (ev.key === "Escape" && !cargando) onCancelar();
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [cargando, onCancelar]);

  const habilitado = faltan <= 0 && !cargando;

  return (
    // Tocar afuera NO cierra ni confirma: la idea es que se lea y se elija.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={idTexto}
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl motion-safe:animate-fade-slide-in"
      >
        <div className={`h-2 ${e.franja}`} aria-hidden="true" />
        <div className="p-6">
          <div className="flex justify-center">
            <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold uppercase tracking-wide ring-1 ring-inset ${e.chip}`}>
              <e.Icono className="h-4 w-4" aria-hidden="true" />
              Contacto {e.nombre}
            </span>
          </div>
          <h3 id={idTitulo} className="mt-4 text-center font-display text-xl font-bold text-navy">
            ¿Estás seguro de cargar en {e.nombre}?
          </h3>
          <p id={idTexto} className="mt-3 text-center text-sm text-ink">
            Los casos de este Excel van a quedar en el área <strong>{e.nombre}</strong>. Si el archivo es de{" "}
            <strong>{e.otra}</strong>, cancelá y elegí «Contacto {e.otra}» arriba.
          </p>

          <dl className="mt-5 space-y-1.5 rounded-lg bg-gray-50 p-4 text-sm">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-muted">Archivo</dt>
              <dd className="flex min-w-0 items-center gap-1.5 font-medium text-ink">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="truncate" title={archivo}>
                  {archivo}
                </span>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-muted">Sucursal</dt>
              <dd className="font-medium text-ink">{sucursal}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-muted">Meses</dt>
              <dd className="font-medium text-ink">{meses.join(", ")}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-muted">Filas</dt>
              <dd className="font-medium text-ink">{filas.toLocaleString("es-AR")}</dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              autoFocus
              onClick={onCancelar}
              disabled={cargando}
              className={claseBoton("fantasma", "border border-gray-300")}
            >
              Cancelar y revisar
            </button>
            <button onClick={onConfirmar} disabled={!habilitado} className={claseBoton("primario")}>
              {cargando
                ? "Importando casos…"
                : faltan > 0
                  ? `Sí, cargar en ${e.nombre} (${faltan})`
                  : `Sí, cargar en ${e.nombre}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
