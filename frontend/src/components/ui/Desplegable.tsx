// ---------------------------------------------------------------------------
// Un desplegable propio, con su menú y su animación
// ---------------------------------------------------------------------------
//
// POR QUÉ NO ES UN <select>. El <select> nativo se puede maquillar por fuera
// —borde, color, tipografía— pero el MENÚ que se abre lo dibuja el sistema
// operativo, y no hay forma de tocarlo: en Windows es un rectángulo blanco con
// esquinas rectas, su propia tipografía y una barra azul de selección. Al lado de
// una pastilla redondeada con el color del estado se ve como un parche pegado, y
// no puede animarse.
//
// EL MENÚ VA EN UN PORTAL, y no es un detalle: la lista de clientes vive dentro
// de un contenedor con overflow-x-auto, y cualquier cosa posicionada adentro se
// corta contra ese borde. Con position: fixed sobre el <body> el menú se dibuja
// por encima de todo, y su posición se recalcula al hacer scroll.
//
// Lo que se conserva del nativo: teclado completo (flechas, Enter, Escape, Home,
// End), roles ARIA para el lector de pantalla, y cerrar al hacer clic afuera. Un
// control inventado que no hace eso es peor que el feo que reemplaza.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface OpcionDesplegable<T extends string> {
  valor: T;
  etiqueta: string;
  /**
   * Se ve en la lista pero no se puede elegir.
   *
   * Existe para los valores que pone el sistema y una persona no debería
   * asignar a mano. Mostrarlos igual es lo correcto: si se ocultaran, el
   * desplegable mostraría un valor distinto del que el registro tiene de verdad.
   */
  deshabilitada?: boolean;
  /**
   * Clases del puntito de color de la izquierda (ej. "bg-green-500").
   *
   * Donde las opciones ya se distinguen por color en la pantalla —los estados de
   * un cliente, el semáforo de un caso— el menú tiene que usar el MISMO color, o
   * quien lo abre pierde la referencia que venía siguiendo con la vista.
   */
  punto?: string;
}

/** Milisegundos de la animación de entrada y de salida. */
const MS_ANIMACION = 130;

interface Props<T extends string> {
  valor: T;
  opciones: Array<OpcionDesplegable<T>>;
  onCambiar: (valor: T) => void;
  deshabilitado?: boolean;
  titulo?: string;
  /** Clases del botón (la "pastilla"). Lo que lo hace parecer lo que es. */
  className?: string;
  /** Ancho mínimo del menú. Por defecto, el del botón. */
  anchoMenu?: number;
}

export function Desplegable<T extends string>({
  valor,
  opciones,
  onCambiar,
  deshabilitado,
  titulo,
  className = "",
  anchoMenu,
}: Props<T>) {
  const id = useId();
  const botonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  // `montado` es si el menú existe en el DOM; `visible` es si ya está en su
  // posición final. Son dos cosas distintas porque una animación de salida
  // necesita que el elemento siga existiendo mientras se va.
  const [montado, setMontado] = useState(false);
  const [visible, setVisible] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, ancho: 0, haciaArriba: false });
  const temporizador = useRef<number | null>(null);

  const elegibles = opciones.filter((o) => !o.deshabilitada);
  const actual = opciones.find((o) => o.valor === valor);

  const ubicar = useCallback(() => {
    const b = botonRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const ancho = Math.max(anchoMenu ?? 0, r.width);
    // Alto estimado del menú para decidir si abre para arriba. No hace falta
    // medirlo exacto: solo se trata de no abrirlo contra el borde de la pantalla.
    const alto = Math.min(opciones.length, 6) * 34 + 12;
    const haciaArriba = r.bottom + alto > window.innerHeight && r.top > alto;
    setPos({
      top: haciaArriba ? r.top - alto - 6 : r.bottom + 6,
      // Que no se salga por la derecha en una tabla ancha, ni por la izquierda
      // en una pantalla angosta (ahí el menú es más ancho que lo que queda).
      left: Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)),
      ancho,
      haciaArriba,
    });
  }, [anchoMenu, opciones.length]);

  const abrir = useCallback(() => {
    if (deshabilitado) return;
    if (temporizador.current) window.clearTimeout(temporizador.current);
    ubicar();
    setMontado(true);
    const i = opciones.findIndex((o) => o.valor === valor);
    setResaltado(i >= 0 ? i : 0);
  }, [deshabilitado, opciones, ubicar, valor]);

  const cerrar = useCallback((devolverFoco = true) => {
    setVisible(false);
    if (temporizador.current) window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => setMontado(false), MS_ANIMACION);
    if (devolverFoco) botonRef.current?.focus();
  }, []);

  // Pasar de "montado" a "visible" en el frame siguiente: si se pusiera el
  // estado final de una, el navegador no tendría entre qué y qué interpolar y la
  // animación no se vería.
  useLayoutEffect(() => {
    if (!montado) return;
    const r = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(r);
  }, [montado]);

  // Clic afuera, y scroll/resize mientras está abierto.
  useEffect(() => {
    if (!montado) return;
    const afuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!botonRef.current?.contains(t) && !menuRef.current?.contains(t)) cerrar(false);
    };
    // capture: el scroll que importa suele ser el del contenedor de la tabla, y
    // el evento de scroll de un hijo no burbujea hasta window.
    const mover = () => ubicar();
    document.addEventListener("mousedown", afuera);
    window.addEventListener("scroll", mover, true);
    window.addEventListener("resize", mover);
    return () => {
      document.removeEventListener("mousedown", afuera);
      window.removeEventListener("scroll", mover, true);
      window.removeEventListener("resize", mover);
    };
  }, [montado, cerrar, ubicar]);

  useEffect(() => () => { if (temporizador.current) window.clearTimeout(temporizador.current); }, []);

  function elegir(o: OpcionDesplegable<T>) {
    if (o.deshabilitada) return;
    cerrar();
    if (o.valor !== valor) onCambiar(o.valor);
  }

  function moverResaltado(paso: number) {
    if (elegibles.length === 0) return;
    // Se salta las deshabilitadas: con las flechas nunca se llega a algo que no
    // se puede elegir.
    let i = resaltado;
    for (let intentos = 0; intentos < opciones.length; intentos++) {
      i = (i + paso + opciones.length) % opciones.length;
      if (!opciones[i].deshabilitada) break;
    }
    setResaltado(i);
  }

  function teclas(e: React.KeyboardEvent) {
    if (!montado) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        abrir();
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        cerrar();
        break;
      case "ArrowDown":
        e.preventDefault();
        moverResaltado(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moverResaltado(-1);
        break;
      case "Home":
        e.preventDefault();
        setResaltado(opciones.findIndex((o) => !o.deshabilitada));
        break;
      case "End":
        e.preventDefault();
        setResaltado(opciones.map((o) => !o.deshabilitada).lastIndexOf(true));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        elegir(opciones[resaltado]);
        break;
      case "Tab":
        cerrar(false);
        break;
    }
  }

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        disabled={deshabilitado}
        title={titulo}
        onClick={() => (montado ? cerrar() : abrir())}
        onKeyDown={teclas}
        aria-haspopup="listbox"
        aria-expanded={montado}
        aria-controls={montado ? id : undefined}
        className={`group inline-flex w-full items-center justify-between gap-1 rounded-full border py-1 pl-3 pr-2 font-sans text-xs font-semibold outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 ${
          deshabilitado ? "" : "cursor-pointer active:scale-[0.97]"
        } ${className}`}
      >
        <span className="truncate">{actual?.etiqueta ?? valor}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform duration-200 ${montado ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {montado &&
        createPortal(
          <ul
            id={id}
            ref={menuRef}
            role="listbox"
            tabIndex={-1}
            style={{ position: "fixed", top: pos.top, left: pos.left, minWidth: pos.ancho }}
            className={`z-50 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg shadow-black/10 ring-1 ring-black/5 transition-all duration-150 ease-out ${
              visible
                ? "translate-y-0 scale-100 opacity-100"
                : `${pos.haciaArriba ? "translate-y-1" : "-translate-y-1"} scale-95 opacity-0`
            }`}
          >
            {opciones.map((o, i) => {
              const elegido = o.valor === valor;
              return (
                <li
                  key={o.valor}
                  role="option"
                  aria-selected={elegido}
                  aria-disabled={o.deshabilitada}
                  onMouseEnter={() => !o.deshabilitada && setResaltado(i)}
                  onClick={() => elegir(o)}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-100 ${
                    o.deshabilitada
                      ? "cursor-default text-ink-muted/70"
                      : `cursor-pointer ${i === resaltado ? "bg-accent-light text-accent-dark" : "text-ink"}`
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {o.punto && (
                      <span className={`h-2 w-2 shrink-0 rounded-full ${o.punto}`} aria-hidden="true" />
                    )}
                    <span className={`truncate ${elegido ? "font-semibold" : ""}`}>{o.etiqueta}</span>
                  </span>
                  {/* El tilde y no un fondo de color: el fondo ya lo usa el
                      resaltado del teclado/mouse, y con los dos encima no se
                      distingue "dónde estoy parado" de "qué está elegido". */}
                  {elegido && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                </li>
              );
            })}
          </ul>,
          document.body
        )}
    </>
  );
}
