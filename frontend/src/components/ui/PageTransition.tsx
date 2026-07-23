import { ReactNode } from "react";
import { useLocation } from "react-router-dom";

// Transición sutil de pantalla (fade + leve desplazamiento) al cambiar de
// ruta. La key por pathname reinicia la animación en cada navegación;
// motion-safe: respeta prefers-reduced-motion automáticamente.
export default function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="motion-safe:animate-fade-slide-in">
      {children}
    </div>
  );
}
