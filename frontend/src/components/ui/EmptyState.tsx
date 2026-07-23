import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

export function EmptyState({
  icono: Icono,
  titulo,
  descripcion,
  accion,
}: {
  icono: LucideIcon;
  titulo: string;
  descripcion?: string;
  accion?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <Icono className="h-8 w-8 text-accent" aria-hidden="true" />
      <p className="text-sm font-medium text-ink">{titulo}</p>
      {descripcion && <p className="max-w-sm text-xs text-ink-muted">{descripcion}</p>}
      {accion && <div className="mt-2">{accion}</div>}
    </div>
  );
}
