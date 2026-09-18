// Las causas raíz de un RQR: una o varias (pedido del dueño, 17-09-2026, las dos
// marcas). Todas valen igual y en los reportes el RQR suma en cada una. La lista
// sale del perfil de la marca, igual que antes el desplegable.
//
// Es el SelectorMultiple con la lista de la marca ya puesta: la estética (campo
// con etiquetas, lista desplegable con buscador) es la misma que la de las
// subáreas de Volkswagen, para que las dos cosas se usen igual.
import { ReactNode } from "react";
import { causasRaiz, etiquetaCategoria } from "../lib/categorias";
import { SelectorMultiple } from "./SelectorMultiple";

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
  return (
    <SelectorMultiple
      opciones={causasRaiz().map((c) => ({ valor: c.codigo, etiqueta: c.etiqueta }))}
      valor={valor}
      onCambiar={onCambiar}
      etiqueta={etiqueta}
      hint={hint}
      deshabilitado={deshabilitado}
      placeholder="Elegí una o varias causas…"
      etiquetaFuera={(codigo) => etiquetaCategoria(codigo)}
    />
  );
}
