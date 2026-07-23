import { ButtonHTMLAttributes, forwardRef } from "react";

export type VarianteBoton = "primario" | "secundario" | "fantasma" | "peligro";

const CLASES: Record<VarianteBoton, string> = {
  primario: "bg-navy text-white hover:bg-navy-dark",
  secundario: "border border-accent text-accent-dark hover:bg-accent-light",
  fantasma: "text-ink-muted hover:bg-gray-100",
  peligro: "border border-red-300 text-red-700 hover:bg-red-50",
};

export function claseBoton(variante: VarianteBoton = "primario", extra = ""): string {
  return `inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${CLASES[variante]} ${extra}`;
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variante = "primario", className = "", ...props },
  ref
) {
  return <button ref={ref} className={claseBoton(variante, className)} {...props} />;
});
