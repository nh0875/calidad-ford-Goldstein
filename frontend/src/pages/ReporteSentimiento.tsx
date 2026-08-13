import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileDown } from "lucide-react";
import { apiDescargarArchivo, apiGet } from "../lib/api";
import { BarraFiltros, FILTROS_VACIOS, FiltrosComunes, filtrosAQuery, useOpcionesCasos } from "../components/filtros";
import { getUsuario, veTodasLasAreas } from "../lib/auth";
import {
  DistribucionEstrellas,
  DistribucionSemaforo,
  EvolucionEstrellas,
  EvolucionSemaforo,
} from "../components/graficos";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { claseBoton } from "../components/ui/Button";

interface Reporte {
  escala: "SEMAFORO" | "ESTRELLAS";
  totales: { VERDE: number; AMARILLO: number; ROJO: number; sinClasificar: number; revisionManual: number };
  porcentajes: { VERDE: number; AMARILLO: number; ROJO: number };
  estrellas: {
    conPuntaje: number;
    distribucion: Record<"1" | "2" | "3" | "4" | "5", number>;
    promedio: number | null;
    pctCinco: number;
  };
  evolucion: {
    agrupacion: "dia" | "semana";
    puntos: Array<{
      fecha: string;
      VERDE: number;
      AMARILLO: number;
      ROJO: number;
      promedioEstrellas: number | null;
    }>;
  };
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
  promedioEstrellas: number | null;
  pctCinco: number;
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

  // Esta marca mide en estrellas Y hay casos puntuados en el rango.
  const porEstrellas = reporte?.escala === "ESTRELLAS" && reporte.estrellas.conPuntaje > 0;

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
            {porEstrellas ? (
              <>
                <Tarjeta
                  titulo="Promedio"
                  valor={`${reporte.estrellas.promedio ?? 0} ★`}
                  detalle={`${reporte.estrellas.conPuntaje} caso(s) puntuados`}
                  color="text-accent-dark"
                />
                <Tarjeta
                  titulo="5 estrellas"
                  valor={`${reporte.estrellas.pctCinco}%`}
                  detalle={`${reporte.estrellas.distribucion["5"]} caso(s)`}
                  color="text-green-700"
                />
                <Tarjeta
                  titulo="1 y 2 estrellas"
                  valor={reporte.estrellas.distribucion["1"] + reporte.estrellas.distribucion["2"]}
                  detalle="clientes disconformes"
                  color="text-red-700"
                />
              </>
            ) : (
              <>
                <Tarjeta titulo="Verdes" valor={reporte.totales.VERDE} detalle={`${reporte.porcentajes.VERDE}%`} color="text-green-700" />
                <Tarjeta titulo="Amarillos" valor={reporte.totales.AMARILLO} detalle={`${reporte.porcentajes.AMARILLO}%`} color="text-yellow-700" />
                <Tarjeta titulo="Rojos" valor={reporte.totales.ROJO} detalle={`${reporte.porcentajes.ROJO}%`} color="text-red-700" />
              </>
            )}
            <Tarjeta
              titulo="Tasa de respuesta"
              valor={`${reporte.tasaRespuesta.pctRespondidos}%`}
              detalle={`${reporte.tasaRespuesta.respondidos} de ${reporte.tasaRespuesta.contactados} contactados`}
              color="text-accent-dark"
            />
            <Tarjeta
              titulo="Revisión manual"
              valor={reporte.totales.revisionManual}
              detalle={
                reporte.totales.revisionManual > 0
                  ? "ver y clasificar →"
                  : reporte.totales.sinClasificar > 0
                    ? `${reporte.totales.sinClasificar} sin clasificar`
                    : "sin pendientes"
              }
              color="text-purple-700"
              to={reporte.totales.revisionManual > 0 ? "/revision-manual" : undefined}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-ink">
                {porEstrellas ? "Distribución de puntajes" : "Distribución del semáforo"}
              </h3>
              {porEstrellas ? (
                <DistribucionEstrellas
                  distribucion={reporte.estrellas.distribucion}
                  conPuntaje={reporte.estrellas.conPuntaje}
                />
              ) : (
                <DistribucionSemaforo totales={reporte.totales} porcentajes={reporte.porcentajes} />
              )}
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
              {porEstrellas ? (
                <EvolucionEstrellas puntos={reporte.evolucion.puntos} agrupacion={reporte.evolucion.agrupacion} />
              ) : (
                <EvolucionSemaforo puntos={reporte.evolucion.puntos} agrupacion={reporte.evolucion.agrupacion} />
              )}
            </Card>
          </div>

          {/* Desgloses */}
          <div className="grid gap-4 lg:grid-cols-2">
            <TablaDesglose
              titulo="Por sucursal"
              filas={ordenar(reporte.porSucursal)}
              orden={orden}
              onOrden={setOrden}
              porEstrellas={porEstrellas}
            />
            <TablaDesglose
              titulo="Por asesor"
              filas={ordenar(reporte.porAsesor)}
              orden={orden}
              onOrden={setOrden}
              porEstrellas={porEstrellas}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Tarjeta({
  titulo,
  valor,
  detalle,
  color,
  to,
}: {
  titulo: string;
  valor: number | string;
  detalle: string;
  color: string;
  to?: string;
}) {
  const contenido = (
    <Card className={to ? "h-full transition-colors hover:border-accent hover:bg-accent-light/40" : undefined}>
      <div className="text-xs text-ink-muted">{titulo}</div>
      <div className={`font-display text-2xl font-bold ${color}`}>{valor}</div>
      <div className={`text-xs ${to ? "font-medium text-accent-dark" : "text-ink-muted"}`}>{detalle}</div>
    </Card>
  );
  return to ? (
    <Link to={to} className="block">
      {contenido}
    </Link>
  ) : (
    contenido
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
  porEstrellas = false,
}: {
  titulo: string;
  filas: Desglose[];
  orden: OrdenDesglose;
  onOrden: (o: OrdenDesglose) => void;
  porEstrellas?: boolean;
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
            {porEstrellas ? (
              <>
                <th className={th}>{botonOrden("total", "Casos")}</th>
                <th className={th}>% 5★</th>
                <th className={th}>{botonOrden("pctRojos", "Promedio")}</th>
              </>
            ) : (
              <>
                <th className={th}>Verdes</th>
                <th className={th}>Amar.</th>
                <th className={th}>Rojos</th>
                <th className={th}>{botonOrden("total", "Total")}</th>
                <th className={th}>{botonOrden("pctRojos", "% Rojos")}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.nombre} className="border-b border-gray-100">
              <td className="px-2 py-1.5 text-ink">{f.nombre}</td>
              {porEstrellas ? (
                <>
                  <td className="px-2 py-1.5 text-right text-ink-muted">{f.total}</td>
                  <td className="px-2 py-1.5 text-right text-ink-muted">{f.pctCinco}%</td>
                  <td
                    className={`px-2 py-1.5 text-right font-medium ${
                      f.promedioEstrellas !== null && f.promedioEstrellas < 4 ? "text-red-700" : "text-ink"
                    }`}
                  >
                    {f.promedioEstrellas !== null ? `${f.promedioEstrellas} ★` : "—"}
                  </td>
                </>
              ) : (
                <>
                  <td className="px-2 py-1.5 text-right text-ink-muted">{f.VERDE}</td>
                  <td className="px-2 py-1.5 text-right text-ink-muted">{f.AMARILLO}</td>
                  <td className="px-2 py-1.5 text-right text-ink-muted">{f.ROJO}</td>
                  <td className="px-2 py-1.5 text-right font-medium text-ink">{f.total}</td>
                  <td className={`px-2 py-1.5 text-right font-medium ${f.pctRojos >= 30 ? "text-red-700" : "text-ink"}`}>
                    {f.pctRojos}%
                  </td>
                </>
              )}
            </tr>
          ))}
          {filas.length === 0 && (
            <tr>
              <td colSpan={porEstrellas ? 4 : 6} className="py-6 text-center text-ink-muted">
                Todavía no hay datos para el rango elegido.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
