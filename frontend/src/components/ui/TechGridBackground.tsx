import { IMAGEN_FONDO_DEALER } from "../../lib/tema";

// Patrón de fondo "diagrama de taller": una grilla técnica fina, casi
// imperceptible, que da textura sin ser literal (no es una foto ni el logo de
// Ford — ver lib/tema.ts para el slot reservado a una foto real futura).
export default function TechGridBackground({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full text-navy" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="grilla-taller" width="64" height="64" patternUnits="userSpaceOnUse">
            <path d="M64 0H0V64" fill="none" stroke="currentColor" strokeWidth="1" />
            <circle cx="0" cy="0" r="1.4" fill="currentColor" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grilla-taller)" opacity="0.045" />
      </svg>
      {IMAGEN_FONDO_DEALER && (
        <img src={IMAGEN_FONDO_DEALER} alt="" className="absolute inset-0 h-full w-full object-cover opacity-10" />
      )}
    </div>
  );
}
