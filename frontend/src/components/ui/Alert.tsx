import { AlertTriangle, CheckCircle2, Info, LucideIcon } from "lucide-react";
import { ReactNode } from "react";

type Tono = "error" | "exito" | "info" | "advertencia";

const ESTILOS: Record<Tono, { clases: string; Icono: LucideIcon }> = {
  error: { clases: "border-red-200 bg-red-50 text-red-800", Icono: AlertTriangle },
  exito: { clases: "border-green-200 bg-green-50 text-green-800", Icono: CheckCircle2 },
  info: { clases: "border-accent/30 bg-accent-light text-navy", Icono: Info },
  advertencia: { clases: "border-amber-300 bg-amber-50 text-amber-800", Icono: AlertTriangle },
};

export function Alert({ tono = "info", children }: { tono?: Tono; children: ReactNode }) {
  const { clases, Icono } = ESTILOS[tono];
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${clases}`} role={tono === "error" ? "alert" : "status"}>
      <Icono className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
