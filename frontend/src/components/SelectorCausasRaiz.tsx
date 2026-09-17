// Las causas raíz de un RQR: una o varias (pedido del dueño, 17-09-2026, las dos
// marcas). Todas valen igual y en los reportes el RQR suma en cada una. La lista
// sale del perfil de la marca, igual que antes el desplegable.
//
// Trae su propio título en un fieldset y NO va adentro de <Campo>: Campo es un
// <label>, y un label con casilleros adentro hace que un clic en el título, en la
// ayuda o entre dos opciones tilde la primera causa.
import { ReactNode } from "react";
import { causasRaiz, etiquetaCategoria } from "../lib/categorias";
import { Etiqueta } from "./ui/Field";

export function SelectorCausasRaiz({
  valor,
  onCambiar,
  etiqueta,
  hint,
  deshabilitado = false,
}: {
  valor: string[];
  onCambiar: (codigos: string[]) => void;
  etiqueta: string;
  hint?: ReactNode;
  deshabilitado?: boolean;
}) {
  const lista = causasRaiz();
  // Una causa que ya no está en la lista de la marca (quedó de una lista anterior)
  // se sigue mostrando, marcada, para poder sacarla: si no, quedaría invisible.
  const fueraDeLista = valor.filter((c) => !lista.some((x) => x.codigo === c));

  const alternar = (codigo: string) =>
    onCambiar(valor.includes(codigo) ? valor.filter((c) => c !== codigo) : [...valor, codigo]);

  return (
    <fieldset className="text-sm">
      <legend className="w-full">
        <Etiqueta>{etiqueta}</Etiqueta>
      </legend>
      <div role="group" aria-label="Causas raíz" className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {lista.map((c) => (
          <label key={c.codigo} className="flex cursor-pointer items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={valor.includes(c.codigo)}
              onChange={() => alternar(c.codigo)}
              disabled={deshabilitado}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-navy focus:ring-accent"
            />
            <span>{c.etiqueta}</span>
          </label>
        ))}
        {fueraDeLista.map((codigo) => (
          <label key={codigo} className="flex cursor-pointer items-start gap-2 text-sm text-red-700">
            <input
              type="checkbox"
              checked
              onChange={() => alternar(codigo)}
              disabled={deshabilitado}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span>{etiquetaCategoria(codigo)} (ya no está en la lista: sacala)</span>
          </label>
        ))}
      </div>
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </fieldset>
  );
}
