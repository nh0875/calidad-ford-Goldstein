// Barra de filtros compartida por reportes y gestión de RQR, para que las
// tres pantallas filtren con la misma semántica (fecha/sucursal/asesor/período).
import { ReactNode, useEffect, useState } from "react";
import { Campo, Input, Select } from "./ui/Field";
import { Card } from "./ui/Card";
import { apiGet } from "../lib/api";
import { AREAS, etiquetaArea } from "../lib/area";

// Opciones reales (sucursal/asesor/período) para poblar los desplegables de
// filtros desde la base, en vez de texto libre (sensible a tildes/tipeo).
export interface OpcionesCasos {
  sucursales: string[];
  asesores: string[];
  periodos: string[];
}

export function useOpcionesCasos(): OpcionesCasos {
  const [opciones, setOpciones] = useState<OpcionesCasos>({ sucursales: [], asesores: [], periodos: [] });
  useEffect(() => {
    apiGet<OpcionesCasos>("/api/casos/opciones")
      .then(setOpciones)
      .catch(() => {
        /* si falla, los desplegables quedan vacíos; no bloquea la pantalla */
      });
  }, []);
  return opciones;
}

export interface FiltrosComunes {
  fechaDesde: string;
  fechaHasta: string;
  sucursal: string;
  asesor: string;
  periodo: string;
}

export const FILTROS_VACIOS: FiltrosComunes = {
  fechaDesde: "",
  fechaHasta: "",
  sucursal: "",
  asesor: "",
  periodo: "",
};

export function filtrosAQuery(f: FiltrosComunes, extra: Record<string, string> = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (f.fechaDesde) params.set("fechaDesde", f.fechaDesde);
  if (f.fechaHasta) params.set("fechaHasta", f.fechaHasta);
  if (f.sucursal.trim()) params.set("sucursal", f.sucursal.trim());
  if (f.asesor.trim()) params.set("asesor", f.asesor.trim());
  if (f.periodo.trim()) params.set("periodo", f.periodo.trim());
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
  return params;
}

export function CampoFiltro({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return <Campo etiqueta={etiqueta}>{children}</Campo>;
}

export function FiltroTexto({
  etiqueta,
  valor,
  placeholder,
  onChange,
}: {
  etiqueta: string;
  valor: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <Campo etiqueta={etiqueta}>
      <Input type="text" value={valor} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Campo>
  );
}

export function FiltroFecha({
  etiqueta,
  valor,
  onChange,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <Campo etiqueta={etiqueta}>
      <Input type="date" value={valor} onChange={(e) => onChange(e.target.value)} />
    </Campo>
  );
}

export function FiltroSelect({
  etiqueta,
  valor,
  opciones,
  onChange,
}: {
  etiqueta: string;
  valor: string;
  opciones: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <Campo etiqueta={etiqueta}>
      <Select value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Todos</option>
        {opciones.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Campo>
  );
}

/**
 * Los cinco filtros comunes; `children` agrega filtros propios de cada pantalla.
 * - `opciones`: si se pasan, sucursal/asesor/período se muestran como desplegables
 *   con los valores reales de la base (evita el problema de tildes/tipeo); si no,
 *   quedan como texto libre.
 * - `ocultarPeriodo`: para pantallas que no filtran por período (ej. /rqr, que
 *   filtra por fecha de apertura, no por período de carga).
 * - `onLimpiar`: si se pasa, muestra un botón "Limpiar filtros".
 */
export function BarraFiltros({
  filtros,
  onChange,
  opciones,
  ocultarPeriodo,
  onLimpiar,
  area,
  onAreaChange,
  mostrarArea,
  children,
}: {
  filtros: FiltrosComunes;
  onChange: (f: FiltrosComunes) => void;
  opciones?: OpcionesCasos;
  ocultarPeriodo?: boolean;
  onLimpiar?: () => void;
  // Filtro de área: solo se muestra para quien ve más de un área (ADMIN/AMBAS).
  area?: string;
  onAreaChange?: (v: string) => void;
  mostrarArea?: boolean;
  children?: ReactNode;
}) {
  const set = (campo: keyof FiltrosComunes) => (v: string) => onChange({ ...filtros, [campo]: v });
  const aOpc = (valores: string[]) => valores.map((v) => ({ value: v, label: v }));
  return (
    <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      {mostrarArea && onAreaChange && (
        <FiltroSelect
          etiqueta="Área"
          valor={area ?? ""}
          opciones={AREAS.map((a) => ({ value: a, label: etiquetaArea(a) }))}
          onChange={onAreaChange}
        />
      )}
      <FiltroFecha etiqueta="Desde" valor={filtros.fechaDesde} onChange={set("fechaDesde")} />
      <FiltroFecha etiqueta="Hasta" valor={filtros.fechaHasta} onChange={set("fechaHasta")} />
      {opciones ? (
        <FiltroSelect etiqueta="Sucursal" valor={filtros.sucursal} opciones={aOpc(opciones.sucursales)} onChange={set("sucursal")} />
      ) : (
        <FiltroTexto etiqueta="Sucursal" valor={filtros.sucursal} placeholder="Ej: San Juan" onChange={set("sucursal")} />
      )}
      {opciones ? (
        <FiltroSelect etiqueta="Asesor" valor={filtros.asesor} opciones={aOpc(opciones.asesores)} onChange={set("asesor")} />
      ) : (
        <FiltroTexto etiqueta="Asesor" valor={filtros.asesor} placeholder="Nombre" onChange={set("asesor")} />
      )}
      {!ocultarPeriodo &&
        (opciones ? (
          <FiltroSelect etiqueta="Período" valor={filtros.periodo} opciones={aOpc(opciones.periodos)} onChange={set("periodo")} />
        ) : (
          <FiltroTexto etiqueta="Período" valor={filtros.periodo} placeholder="AAAA-MM" onChange={set("periodo")} />
        ))}
      {children}
      {onLimpiar && (
        <div className="flex items-end justify-end sm:col-span-2 lg:col-span-6">
          <button onClick={onLimpiar} className="text-sm font-medium text-accent-dark hover:underline">
            Limpiar filtros
          </button>
        </div>
      )}
    </Card>
  );
}
