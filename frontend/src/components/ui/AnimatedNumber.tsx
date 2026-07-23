import { useEffect, useState } from "react";

interface Props {
  value: number;
  formatear?: (v: number) => string;
  duracionMs?: number;
}

// Cuenta de 0 al valor final cada vez que `value` cambia de verdad (carga
// inicial o nuevo filtro aplicado) — no en cada re-render del componente
// padre, porque el efecto solo se dispara cuando cambia la dependencia.
// Respeta prefers-reduced-motion mostrando el valor final sin animar.
export default function AnimatedNumber({
  value,
  formatear = (v) => String(Math.round(v)),
  duracionMs = 900,
}: Props) {
  const [mostrado, setMostrado] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMostrado(value);
      return;
    }
    let cuadro: number;
    const inicio = performance.now();
    const tick = (ahora: number) => {
      const progreso = Math.min(1, (ahora - inicio) / duracionMs);
      const facilitado = 1 - Math.pow(1 - progreso, 3);
      setMostrado(value * facilitado);
      if (progreso < 1) cuadro = requestAnimationFrame(tick);
    };
    cuadro = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(cuadro);
  }, [value, duracionMs]);

  return <>{formatear(mostrado)}</>;
}
