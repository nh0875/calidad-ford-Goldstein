// Selector de VARIAS opciones: un campo que muestra lo elegido como etiquetas y,
// al tocarlo, despliega la lista con casilleros y un buscador (pedido del dueño,
// 17-09-2026: "que sea un menú desplegable más lindo").
//
// Lo usan las causas raíz de un RQR y las subáreas de Volkswagen. Antes eran un
// <select> de una sola opción y una grilla de casilleros siempre abierta: la
// grilla ocupaba media pantalla y el select no dejaba elegir más de una.
//
// NO va adentro de <Campo>: Campo es un <label>, y un label con casilleros
// adentro hace que un clic en el título o en la ayuda marque la primera opción.
// Por eso trae su propio título, en un fieldset.
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Etiqueta } from "./ui/Field";

export interface OpcionMultiple {
  valor: string;
  etiqueta: string;
  /** Texto chico abajo de la opción (ej. cuándo usar esa causa raíz). */
  descripcion?: string;
}

export function SelectorMultiple({
  opciones,
  valor,
  onCambiar,
  etiqueta,
  hint,
  placeholder = "Elegí una o varias…",
  deshabilitado = false,
  textoDeshabilitado,
  buscadorDesde = 8,
  etiquetaFuera,
}: {
  opciones: OpcionMultiple[];
  valor: string[];
  onCambiar: (valores: string[]) => void;
  etiqueta: string;
  hint?: ReactNode;
  placeholder?: string;
  deshabilitado?: boolean;
  /** Qué decir cuando está deshabilitado (ej. "Elegí primero el área principal"). */
  textoDeshabilitado?: string;
  /** A partir de cuántas opciones aparece el buscador. */
  buscadorDesde?: number;
  /** Cómo mostrar un valor guardado que ya no está en la lista. */
  etiquetaFuera?: (valor: string) => string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const caja = useRef<HTMLFieldSetElement>(null);
  const campoBusqueda = useRef<HTMLInputElement>(null);

  // Un valor guardado que ya no está en la lista (quedó de un catálogo anterior)
  // se sigue mostrando, marcado, para poder sacarlo: si no, quedaría invisible y
  // seguiría contando en los reportes sin que nadie lo vea.
  const fueraDeLista = valor.filter((v) => !opciones.some((o) => o.valor === v));

  useEffect(() => {
    if (!abierto) return;
    const alTocarAfuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", alTocarAfuera);
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("mousedown", alTocarAfuera);
      document.removeEventListener("keydown", alTeclear);
    };
  }, [abierto]);

  useEffect(() => {
    if (abierto) campoBusqueda.current?.focus();
    else setBusqueda("");
  }, [abierto]);

  // Se busca sin acentos y sin mayúsculas: nadie escribe "Reparación" completo.
  const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const visibles = useMemo(() => {
    const q = normal(busqueda.trim());
    if (!q) return opciones;
    return opciones.filter((o) => normal(o.etiqueta).includes(q) || normal(o.descripcion ?? "").includes(q));
  }, [opciones, busqueda]);

  const alternar = (v: string) =>
    onCambiar(valor.includes(v) ? valor.filter((x) => x !== v) : [...valor, v]);

  const nombre = (v: string) =>
    opciones.find((o) => o.valor === v)?.etiqueta ?? (etiquetaFuera ? etiquetaFuera(v) : v);

  return (
    <fieldset
      // min-w-0: el navegador le da a todo <fieldset> un min-inline-size de
      // min-content que Tailwind no resetea. Sin esto, el "truncate" de las
      // etiquetas no actúa nunca —el ancho mínimo del campo pasa a ser el texto
      // entero de la etiqueta más larga— y en un celular el campo se sale de la
      // tarjeta en vez de recortarse.
      className="min-w-0 text-sm"
      ref={caja}
      // Si el foco se va del selector con Tab, la lista se cierra: si no, queda
      // abierta tapando los campos de abajo mientras se escribe en otro lado.
      // Se exige relatedTarget para no cerrarla al hacer clic con el mouse en una
      // zona del panel que no toma foco (eso ya lo maneja el clic de afuera).
      onBlur={(e) => {
        const destino = e.relatedTarget as Node | null;
        if (destino && !caja.current?.contains(destino)) setAbierto(false);
      }}
    >
      <legend className="w-full">
        <Etiqueta>{etiqueta}</Etiqueta>
      </legend>

      <div className="relative">
        <button
          type="button"
          disabled={deshabilitado}
          onClick={() => setAbierto((a) => !a)}
          aria-expanded={abierto}
          aria-label={etiqueta}
          // min-h para que mida lo mismo que un <input> aunque no haya nada
          // elegido: si no, el campo vacío queda más bajo que los de al lado y la
          // fila se ve despareja.
          className={`flex min-h-[38px] w-full items-center gap-2 rounded-md border bg-white px-3 py-1.5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:bg-gray-50 ${
            abierto ? "border-accent ring-2 ring-accent/30" : "border-gray-300 hover:border-gray-400"
          }`}
        >
          <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {valor.length === 0 ? (
              <span className="truncate text-sm text-gray-400">
                {deshabilitado && textoDeshabilitado ? textoDeshabilitado : placeholder}
              </span>
            ) : (
              valor.map((v) => (
                <span
                  key={v}
                  className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                    fueraDeLista.includes(v) ? "bg-red-50 text-red-700" : "bg-navy/10 text-navy"
                  }`}
                >
                  <span className="truncate">{nombre(v)}</span>
                  {/* Sacar una sin abrir la lista. Es un <span> y no un <button>
                      porque ya estamos adentro de un botón, y un botón adentro de
                      otro no es HTML válido: el navegador lo saca del medio y deja
                      de funcionar. */}
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Sacar ${nombre(v)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!deshabilitado) alternar(v);
                    }}
                    className="-mr-0.5 cursor-pointer rounded-full p-1 hover:bg-black/10"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </span>
                </span>
              ))
            )}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-ink-muted transition-transform ${abierto ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>

        {abierto && (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
            {opciones.length >= buscadorDesde && (
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <input
                  ref={campoBusqueda}
                  type="text"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar…"
                  className="w-full border-0 p-0 font-sans text-sm text-ink placeholder:text-gray-400 focus:outline-none focus:ring-0"
                />
              </div>
            )}

            <div className="max-h-64 overflow-y-auto py-1">
              {visibles.length === 0 && fueraDeLista.length === 0 ? (
                <p className="px-3 py-3 text-sm text-ink-muted">No hay ninguna opción con ese texto.</p>
              ) : (
                visibles.map((o) => {
                  const elegida = valor.includes(o.valor);
                  return (
                    <label
                      key={o.valor}
                      // El casillero real es sr-only (invisible), así que el
                      // foco del teclado se marca en la FILA: sin esto, quien
                      // recorre la lista con Tab no ve dónde está parado.
                      className={`flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm hover:bg-canvas has-[:focus-visible]:bg-accent/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-accent ${
                        elegida ? "bg-accent/5" : ""
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          elegida ? "border-navy bg-navy text-white" : "border-gray-300 bg-white"
                        }`}
                      >
                        {elegida && <Check className="h-3 w-3" aria-hidden="true" />}
                      </span>
                      <input
                        type="checkbox"
                        checked={elegida}
                        onChange={() => alternar(o.valor)}
                        className="sr-only"
                      />
                      <span className="min-w-0">
                        <span className="block text-ink">{o.etiqueta}</span>
                        {o.descripcion && <span className="block text-xs text-ink-muted">{o.descripcion}</span>}
                      </span>
                    </label>
                  );
                })
              )}

              {/* Las que ya no están en el catálogo, al final y en rojo. */}
              {fueraDeLista.map((v) => (
                <label
                  key={v}
                  className="flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm text-red-700 hover:bg-canvas has-[:focus-visible]:bg-red-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-red-400"
                >
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-red-300 bg-red-600 text-white">
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                  <input type="checkbox" checked onChange={() => alternar(v)} className="sr-only" />
                  <span>
                    {nombre(v)} <span className="text-xs">(ya no está en la lista: sacala)</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-1.5 text-xs text-ink-muted">
              <span>{valor.length === 0 ? "Ninguna elegida" : `${valor.length} elegida(s)`}</span>
              <span className="flex gap-3">
                {valor.length > 0 && (
                  <button type="button" onClick={() => onCambiar([])} className="font-medium text-accent-dark hover:underline">
                    Limpiar
                  </button>
                )}
                <button type="button" onClick={() => setAbierto(false)} className="font-medium text-accent-dark hover:underline">
                  Listo
                </button>
              </span>
            </div>
          </div>
        )}
      </div>

      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </fieldset>
  );
}
