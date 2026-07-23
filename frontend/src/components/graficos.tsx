// Gráficos SVG sin dependencias, siguiendo la guía de dataviz:
// - colores de status para el semáforo (validados; el ámbar exige etiquetas
//   visibles sobre fondo claro, por eso todos los marks llevan valor al lado)
// - azul secuencial para magnitudes por categoría
// - marcas finas, extremos redondeados, grilla y ejes recesivos, tooltip al hover
import { useMemo, useRef, useState } from "react";

export const COLOR_SEMAFORO: Record<string, string> = {
  VERDE: "#0ca30c",
  AMARILLO: "#fab219",
  ROJO: "#d03b3b",
};
const AZUL = "#3E7CB1";
const AZUL_CLARO = "#9CC3E0";
const GRILLA = "#E5E7EB";
const EJE = "#CBD5E1";
const TINTA_MUTED = "#5B6472";

const ETIQUETA_SEMAFORO: Record<string, string> = {
  VERDE: "Verdes",
  AMARILLO: "Amarillos",
  ROJO: "Rojos",
};

// ---------- Distribución del semáforo (barras horizontales) ----------

export function DistribucionSemaforo({
  totales,
  porcentajes,
}: {
  totales: { VERDE: number; AMARILLO: number; ROJO: number };
  porcentajes: { VERDE: number; AMARILLO: number; ROJO: number };
}) {
  const semaforos = ["VERDE", "AMARILLO", "ROJO"] as const;
  const maximo = Math.max(1, ...semaforos.map((s) => totales[s]));

  return (
    <div className="space-y-2" role="img" aria-label="Distribución del semáforo">
      {semaforos.map((s) => (
        <div key={s} className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-right text-xs text-ink-muted">{ETIQUETA_SEMAFORO[s]}</span>
          <div className="h-6 flex-1">
            <div
              className="flex h-6 items-center rounded-r"
              style={{
                width: `${Math.max(2, (totales[s] / maximo) * 100)}%`,
                backgroundColor: COLOR_SEMAFORO[s],
                minWidth: totales[s] > 0 ? 8 : 2,
              }}
              title={`${ETIQUETA_SEMAFORO[s]}: ${totales[s]} (${porcentajes[s]}%)`}
            />
          </div>
          {/* etiqueta visible: obligatoria porque el ámbar es sub-3:1 sobre claro */}
          <span className="w-24 shrink-0 text-sm font-medium text-ink">
            {totales[s]} <span className="text-xs font-normal text-ink-muted">({porcentajes[s]}%)</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Evolución temporal (líneas, 3 series) ----------

interface PuntoEvolucion {
  fecha: string;
  VERDE: number;
  AMARILLO: number;
  ROJO: number;
}

export function EvolucionSemaforo({
  puntos,
  agrupacion,
}: {
  puntos: PuntoEvolucion[];
  agrupacion: "dia" | "semana";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const ancho = 720;
  const alto = 240;
  const margen = { arriba: 12, abajo: 28, izquierda: 34, derecha: 12 };
  const anchoUtil = ancho - margen.izquierda - margen.derecha;
  const altoUtil = alto - margen.arriba - margen.abajo;

  const series = ["VERDE", "AMARILLO", "ROJO"] as const;
  const maximo = Math.max(1, ...puntos.flatMap((p) => series.map((s) => p[s])));

  const x = (i: number) =>
    margen.izquierda + (puntos.length <= 1 ? anchoUtil / 2 : (i / (puntos.length - 1)) * anchoUtil);
  const y = (v: number) => margen.arriba + altoUtil - (v / maximo) * altoUtil;

  const lineas = useMemo(
    () =>
      series.map((s) => ({
        serie: s,
        d: puntos.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p[s])}`).join(" "),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puntos]
  );

  if (puntos.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-muted">Todavía no hay datos para este rango.</p>;
  }

  const ticksY = [0, Math.ceil(maximo / 2), maximo];
  // Etiquetas de X ralas para que no colisionen
  const pasoX = Math.max(1, Math.ceil(puntos.length / 8));

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * ancho;
    let mejor = 0;
    let distancia = Infinity;
    for (let i = 0; i < puntos.length; i++) {
      const d = Math.abs(x(i) - px);
      if (d < distancia) {
        distancia = d;
        mejor = i;
      }
    }
    setHover(mejor);
  }

  const p = hover !== null ? puntos[hover] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${ancho} ${alto}`}
        className="w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Evolución del semáforo por ${agrupacion}`}
      >
        {/* grilla recesiva */}
        {ticksY.map((t) => (
          <g key={t}>
            <line x1={margen.izquierda} x2={ancho - margen.derecha} y1={y(t)} y2={y(t)} stroke={GRILLA} strokeWidth={1} />
            <text x={margen.izquierda - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={TINTA_MUTED}>
              {t}
            </text>
          </g>
        ))}
        <line
          x1={margen.izquierda}
          x2={ancho - margen.derecha}
          y1={y(0)}
          y2={y(0)}
          stroke={EJE}
          strokeWidth={1}
        />
        {/* etiquetas X */}
        {puntos.map((punto, i) =>
          i % pasoX === 0 ? (
            <text key={punto.fecha} x={x(i)} y={alto - 8} textAnchor="middle" fontSize={11} fill={TINTA_MUTED}>
              {punto.fecha.slice(5)}
            </text>
          ) : null
        )}
        {/* crosshair */}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={margen.arriba} y2={y(0)} stroke={EJE} strokeWidth={1} strokeDasharray="3 3" />
        )}
        {/* series: líneas de 2px con anillo blanco en los marcadores */}
        {lineas.map(({ serie, d }) => (
          <path key={serie} d={d} fill="none" stroke={COLOR_SEMAFORO[serie]} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {hover !== null &&
          series.map((s) => (
            <circle
              key={s}
              cx={x(hover)}
              cy={y(puntos[hover][s])}
              r={4}
              fill={COLOR_SEMAFORO[s]}
              stroke="#ffffff"
              strokeWidth={2}
            />
          ))}
      </svg>

      {/* tooltip */}
      {p && (
        <div
          className="pointer-events-none absolute top-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md"
          style={{
            left: `${Math.min(85, Math.max(2, (x(puntos.indexOf(p)) / ancho) * 100 + 2))}%`,
          }}
        >
          <div className="mb-1 font-semibold text-ink">
            {agrupacion === "semana" ? "Semana del " : ""}
            {p.fecha}
          </div>
          {series.map((s) => (
            <div key={s} className="flex items-center gap-1.5 text-ink-muted">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: COLOR_SEMAFORO[s] }} />
              {ETIQUETA_SEMAFORO[s]}: <span className="font-medium">{p[s]}</span>
            </div>
          ))}
        </div>
      )}

      {/* leyenda (siempre presente: 3 series) */}
      <div className="mt-1 flex justify-center gap-4 text-xs text-ink-muted">
        {series.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: COLOR_SEMAFORO[s] }} />
            {ETIQUETA_SEMAFORO[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- Barras horizontales por categoría (magnitud, azul secuencial) ----------

export function BarrasCategorias({
  items,
}: {
  items: Array<{ etiqueta: string; conRqr: number; sinRqr: number }>;
}) {
  if (items.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-muted">Todavía no hay datos para este rango.</p>;
  }
  const maximo = Math.max(1, ...items.map((i) => i.conRqr + i.sinRqr));

  return (
    <div>
      <div className="space-y-2" role="img" aria-label="Casos por categoría de causa raíz">
        {items.map((item) => {
          const total = item.conRqr + item.sinRqr;
          return (
            <div key={item.etiqueta} className="flex items-center gap-2">
              <span className="w-44 shrink-0 truncate text-right text-xs text-ink-muted" title={item.etiqueta}>
                {item.etiqueta}
              </span>
              {/* segmentos con separador de 2px (gap) sobre la superficie */}
              <div className="flex h-6 flex-1 items-center gap-0.5">
                {item.conRqr > 0 && (
                  <div
                    className="h-6 rounded-l"
                    style={{ width: `${(item.conRqr / maximo) * 100}%`, backgroundColor: AZUL, minWidth: 6 }}
                    title={`Con RQR: ${item.conRqr}`}
                  />
                )}
                {item.sinRqr > 0 && (
                  <div
                    className="h-6 rounded-r"
                    style={{ width: `${(item.sinRqr / maximo) * 100}%`, backgroundColor: AZUL_CLARO, minWidth: 6 }}
                    title={`Amarillos sin RQR: ${item.sinRqr}`}
                  />
                )}
              </div>
              <span className="w-10 shrink-0 text-sm font-medium text-ink">{total}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-center gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: AZUL }} />
          Con RQR
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: AZUL_CLARO }} />
          Amarillos sin RQR
        </span>
      </div>
    </div>
  );
}
