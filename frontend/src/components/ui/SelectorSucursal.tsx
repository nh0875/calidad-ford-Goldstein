// ---------------------------------------------------------------------------
// El desplegable de sucursal
// ---------------------------------------------------------------------------
//
// POR QUÉ EXISTE. La sucursal se escribía a mano, y la sucursal es lo que decide
// QUIÉN VE cada cosa en el sistema. Un typo —"San juan", "SAN JUAN ",
// "Sanjuan"— no da error, no se ve raro en ninguna pantalla, y simplemente hace
// que un usuario asignado a "San Juan" deje de ver todo lo que quedó cargado con
// la variante equivocada. Sin ningún cartel que explique por qué.
//
// Ya pasó con una carga de 104 clientes, y costó días encontrarlo.
//
// Las opciones salen del perfil de la marca, no de lo que haya en la base: si
// salieran de la base, un typo hecho una vez quedaría como opción para siempre y
// el siguiente lo elegiría creyendo que está bien.

import { SelectHTMLAttributes } from "react";
import { getMarca } from "../../lib/marca";
import { Select } from "./Field";

/** Lo que se guarda cuando algo no pertenece a una sucursal en particular. */
export const SUCURSAL_GENERAL = "General";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  valor: string;
  onCambiar: (valor: string) => void;
  /**
   * Qué ofrecer además de las sucursales reales:
   *   "general" — para las CARGAS: "General", cuando el archivo no es de una
   *               sucursal puntual.
   *   "todas"   — para los USUARIOS: sin provincia asignada = ve todas.
   *   "ninguna" — obligatorio elegir una sucursal real.
   */
  extra?: "general" | "todas" | "ninguna";
};

export function SelectorSucursal({ valor, onCambiar, extra = "ninguna", ...rest }: Props) {
  const { sucursales } = getMarca();

  return (
    <>
      <Select value={valor} onChange={(e) => onCambiar(e.target.value)} {...rest}>
        {extra === "ninguna" && <option value="">Elegí una sucursal…</option>}
        {extra === "todas" && <option value="">Todas las provincias</option>}
        {sucursales.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
        {/* Un registro viejo puede tener una sucursal que ya no está en la lista
            (se escribió a mano antes de que esto existiera). Se muestra tal cual
            para que la pantalla no mienta —si no, el desplegable mostraría
            "Mendoza" sobre un registro que dice otra cosa— y se puede reemplazar
            eligiendo una de las de arriba. No queda como opción para los
            registros nuevos. */}
        {valor && valor !== SUCURSAL_GENERAL && !sucursales.includes(valor) && (
          <option value={valor}>{valor} (fuera de la lista)</option>
        )}
        {extra === "general" && <option value={SUCURSAL_GENERAL}>{SUCURSAL_GENERAL}</option>}
      </Select>

      {/* Se avisa al elegir "General" porque su efecto sorprende: NO lo ve nadie
          que tenga una provincia asignada. Es correcto —"General" no coincide con
          "Mendoza" ni con "San Juan"— pero quien lo elige suele creer que
          significa "lo ven todos", que es justo al revés. */}
      {extra === "general" && valor === SUCURSAL_GENERAL && (
        <span className="mt-1 block text-xs text-amber-700">
          Ojo: lo cargado como “General” solo lo ven los usuarios <strong>sin provincia asignada</strong>. Si esto
          es de una sucursal, elegila.
        </span>
      )}
    </>
  );
}
