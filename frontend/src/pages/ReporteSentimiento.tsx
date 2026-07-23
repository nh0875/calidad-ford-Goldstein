import { useCallback, useEffect, useState } from "react";
import { FileDown } from "lucide-react";
import { apiDescargarArchivo, apiGet } from "../lib/api";
import { BarraFiltros, FILTROS_VACIOS, FiltrosComunes, filtrosAQuery, useOpcionesCasos } from "../components/filtros";
import { getUsuario, veTodasLasAreas } from "../lib/auth";
import { DistribucionSemaforo, EvolucionSemaforo } from "../components/graficos";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { claseBoton } from "../components/ui/Button";

interface Reporte {
  totales: { VERDE: number; AMARILLO: number; ROJO: number; sinClasificar: number; revisionManual: number };
  porcentajes: { VERDE: number; AMARILLO: number; ROJO: number };
  evolucion: { agrupacion: "dia" | "semana"; puntos: Array<{ fecha: string; VERDE: number; AMARILLO: number; ROJO: number }> };
  porSucursal: Desglose[];
  porAsesor: Desglose[];
  tasaRespuesta: {
    contactados: number;
    respondidos: number;
    noRespondieron: number;
    enviadosSinRespuestaAun: number;
    conErrorDeEnvio: number;
    internosExcluidos: number;
    pendientesSinContactar: number;
    pctRespondidos: number;
    pctNoRespondieron: number;
  };
}

interface Desglose {
  nombre: string;
  VERDE: number;
  AMARILLO: number;
  ROJO: number;
  total: number;
  pctRojos: number;
}

type OrdenDesglose = "pctRojos" | "total";

export default function ReporteSentimiento() {
  const [filtros, setFiltros] = useState<FiltrosComunes>(FILTROS_VACIOS);
  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orden, setOrden] = useState<OrdenDesglose>("pctRojos");
  const [area, setArea] = useState("");
  const opciones = useOpcionesCasos();
  const mostrarArea = veTodasLasAreas(getUsuario());

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setReporte(await apiGet<Reporte>(`/api/reportes/sentimiento?${filtrosAQuery(filtros, { area })}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar el reporte. Probá recargar la página.");
    }
  }, [filtros, area]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const ordenar = (filas: Desglose[]) =>
    [...filas].sort((a, b) => (orden === "pctRojos" ? b.pctRojos - a.pctRojos : b.total - a.total));

  return (
    <div className="space-y-4">
      <BarraFiltros
        filtros={filtros}
        onChange={setFiltros}
        opciones={opciones}
        area={area}
        onAreaChange={setArea}
        mostrarArea={mostrarArea}
        onLimpiar={() => {
          setFiltros(FILTROS_VACIOS);
          setArea("");
        }}
      >
        <div className="flex items-end">
          <button
            onClick={() =>
              apiDescargarArchivo(
                `/api/reportes/sentimiento/exportar?${filtrosAQuery(filtros, { area })}`,
                "reporte-sentimiento.xlsx"
              ).catch((err) => setError(err instanceof Error ? err.message : "No pudimos descargar el archivo."))
            }
            className={claseBoton("secundario", "w-full")}
          >
            <FileDown className="h-4 w-4" aria-hidden="true" />
            Exportar a Excel
          </button>
        </div>
      </BarraFiltros>

      {error && <Alert tono="error">{error}</Alert>}

      {reporte && (
        <>
          {/* Tarjetas resumen */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Tarjeta titulo="Verdes" valor={reporte.totales.VERDE} detalle={`${reporte.porcentajes.VERDE}%`} color="text-green-700" />
            <Tarjeta titulo="Amarillos" valor={reporte.totales.AMARILLO} detalle={`${reporte.porcentajes.AMARILLO}%`} color="text-yellow-700" />
            <Tarjeta titulo="Rojos" valor={reporte.totales.ROJO} detalle={`${reporte.porcentajes.ROJO}%`} color="text-red-700" />
            <Tarjeta
              titulo="Tasa de respuesta"
              valor={`${reporte.tasaRespuesta.pctRespondidos}%`}
              detalle={`${reporte.tasaRespuesta.respondidos} de ${reporte.tasaRespuesta.contactados} contactados`}
              color="text-accent-dark"
            />
            <Tarjeta
              titulo="Revisión manual"
              valor={reporte.totales.revisionManual}
              detalle={reporte.totales.sinClasificar > 0 ? `${reporte.totales.sinClasificar} sin clasificar` : "pendientes"}
              color="text-purple-700"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-ink">Distribución del semáforo</h3>
              <DistribucionSemaforo totales={reporte.totales} porcentajes={reporte.porcentajes} />
              <h4 className="mb-1 mt-5 text-xs font-semibold uppercase text-ink-muted">Estado de contacto</h4>
              <table className="w-full text-sm">
                <tbody>
                  <FilaTasa etiqueta="Respondieron" valor={reporte.tasaRespuesta.respondidos} pct={reporte.tasaRespuesta.pctRespondidos} />
                  <FilaTasa etiqueta="No respondieron" valor={reporte.tasaRespuesta.noRespondieron} pct={reporte.tasaRespuesta.pctNoRespondieron} />
                  <FilaTasa etiqueta="Enviados, esperando respuesta" valor={reporte.tasaRespuesta.enviadosSinRespuestaAun} />
                  <FilaTasa etiqueta="Con error de envío" valor={reporte.tasaRespuesta.conErrorDeEnvio} />
                  <FilaTasa etiqueta="Internos (excluidos del cálculo)" valor={reporte.tasaRespuesta.internosExcluidos} />
                  <FilaTasa etiqueta="Pendientes sin contactar" valor={reporte.tasaRespuesta.pendientesSinContactar} />
                </tbody>
              </table>
            </Card>

            <Card>
              <h3 className="mb-3 text-sm font-semibold text-ink">
                Evolución {reporte.evolucion.agrupacion === "semana" ? "semanal" : "diaria"}
              </h3>
              <EvolucionSemaforo puntos={reporte.evolucion.puntos} agrupacion={reporte.evolucion.agrupacion} />
            </Card>
          </div>

          {/* Desgloses */}
          <div className="grid gap-4 lg:grid-cols-2">
            <TablaDesglose titulo="Por sucursal" filas={ordenar(reporte.porSucursal)} orden={orden} onOrden={setOrden} />
            <TablaDesglose titulo="Por asesor" filas={ordenar(reporte.porAsesor)} orden={orden} onOrden={setOrden} />
          </div>
        </>
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, detalle, color }: { titulo: string; valor: number | string; detalle: string; color: string }) {
  return (
    <Card>
      <div className="text-xs text-ink-muted">{titulo}</div>
      <div className={`font-display text-2xl font-bold ${color}`}>{valor}</div>
      <div className="text-xs text-ink-muted">{detalle}</div>
    </Card>
  );
}

function FilaTasa({ etiqueta, valor, pct }: { etiqueta: string; valor: number; pct?: number }) {
  return (
    <tr className="border-t border-gray-100">
      <td className="py-1 text-ink-muted">{etiqueta}</td>
      <td className="py-1 text-right font-medium text-ink">
        {valor}
        {pct !== undefined && <span className="ml-1 text-xs font-normal text-ink-muted">({pct}%)</span>}
      </td>
    </tr>
  );
}

function TablaDesglose({
  titulo,
  filas,
  orden,
  onOrden,
}: {
  titulo: string;
  filas: Desglose[];
  orden: OrdenDesglose;
  onOrden: (o: OrdenDesglose) => void;
}) {
  const th = "px-2 py-1.5 text-right text-xs font-medium uppercase text-ink-muted";
  const botonOrden = (campo: OrdenDesglose, texto: string) => (
    <button
      onClick={() => onOrden(campo)}
      className={orden === campo ? "text-accent-dark underline" : ""}
      title="Ordenar por esta columna"
    >
      {texto}
      {orden === campo ? " ↓" : ""}
    </button>
  );
  return (
    <Card className="overflow-x-auto">
      <h3 className="mb-2 text-sm font-semibold text-ink">{titulo}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="px-2 py-1.5 text-left text-xs font-medium uppercase text-ink-muted">Nombre</th>
            <th className={th}>Verdes</th>
            <th className={th}>Amar.</th>
            <th className={th}>Rojos</th>
            <th className={th}>{botonOrden("total", "Total")}</th>
            <th className={th}>{botonOrden("pctRojos", "% Rojos")}</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.nombre} className="border-b border-gray-100">
              <td className="px-2 py-1.5 text-ink">{f.nombre}</td>
              <td className="px-2 py-1.5 text-right text-ink-muted">{f.VERDE}</td>
              <td className="px-2 py-1.5 text-right text-ink-muted">{f.AMARILLO}</td>
              <td className="px-2 py-1.5 text-right text-ink-muted">{f.ROJO}</td>
              <td className="px-2 py-1.5 text-right font-medium text-ink">{f.total}</td>
              <td className={`px-2 py-1.5 text-right font-medium ${f.pctRojos >= 30 ? "text-red-700" : "text-ink"}`}>
                {f.pctRojos}%
              </td>
            </tr>
          ))}
          {filas.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-ink-muted">
                Todavía no hay datos para el rango elegido.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
