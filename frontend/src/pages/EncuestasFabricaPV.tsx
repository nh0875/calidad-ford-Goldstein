// Encuestas de fábrica de Posventa (Volkswagen).
//
// Los clientes de Posventa que calificaron con 5 estrellas —los promotores— entran
// SOLOS a esta lista. Calidad los contacta para animarlos a responder la encuesta
// de fábrica y marca cómo va cada uno: Pendiente → Primer contacto → Respondió, o
// Cerrado si se lo dejó de trabajar sin respuesta. Abajo, el mismo seguimiento mes a
// mes que las encuestas de Ventas.
//
// Los GRÁFICOS los ve cualquier perfil. La LISTA es de Calidad de Posventa de la
// sucursal: a quien no la trabaja el backend le responde 403 con el motivo, y la
// pantalla muestra ese motivo en lugar de la lista.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Award, MessagesSquare } from "lucide-react";
import { apiGet, apiPatchJson } from "../lib/api";
import { getMarca } from "../lib/marca";
import { esSoloFidelizacion, getUsuario } from "../lib/auth";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Input, Select } from "../components/ui/Field";
import { EmptyState } from "../components/ui/EmptyState";
import { SkeletonBlock } from "../components/ui/Skeleton";
import { Desplegable } from "../components/ui/Desplegable";
import CierreDeMeses, { esDeMesCerrado } from "../components/CierreDeMeses";
import {
  BarrasAnimacionPorMes,
  etiquetaMes,
  RankingVendedoresAnimacion,
  SeguimientoEncuestas,
  TablaAnimacionPorMes,
  TEXTOS_POSVENTA,
} from "../components/SeguimientoAnimaciones";

// En la base es el MISMO enum que las encuestas de Ventas (PENDIENTE / AVISADO /
// RESPONDIO), más CERRADO, que es solo de esta pestaña. Acá no hay un vendedor al
// que avisarle —al cliente lo contacta Calidad—, así que AVISADO se lee "Primer
// contacto" (hasta el 19-09-2026 decía "Animado"). CERRADO: se lo dejó de trabajar
// sin respuesta; en los gráficos cuenta como contactado que no respondió.
const ESTADOS = ["PENDIENTE", "AVISADO", "RESPONDIO", "CERRADO"] as const;
type Estado = (typeof ESTADOS)[number];

const ETIQUETA_ESTADO: Record<Estado, string> = {
  PENDIENTE: "Pendiente",
  AVISADO: "Primer contacto",
  RESPONDIO: "Respondió",
  CERRADO: "Cerrado",
};

// Los mismos colores que la pestaña de Ventas y que los gráficos: amarillo lo que
// falta, celeste lo que espera respuesta, verde lo que ya respondió y gris lo que
// ya no se trabaja.
const CLASE_ESTADO: Record<Estado, string> = {
  PENDIENTE: "bg-yellow-50 text-yellow-900 border-yellow-200 hover:bg-yellow-100",
  AVISADO: "bg-accent-light text-accent-dark border-accent/30 hover:bg-accent-light/70",
  RESPONDIO: "bg-green-50 text-green-900 border-green-200 hover:bg-green-100",
  CERRADO: "bg-gray-100 text-ink-muted border-gray-300 hover:bg-gray-200",
};
const PUNTO_ESTADO: Record<Estado, string> = {
  PENDIENTE: "bg-yellow-400",
  AVISADO: "bg-accent",
  RESPONDIO: "bg-green-500",
  CERRADO: "bg-gray-400",
};
const TONO_ESTADO: Record<Estado, "amarillo" | "azul" | "verde" | "gris"> = {
  PENDIENTE: "amarillo",
  AVISADO: "azul",
  RESPONDIO: "verde",
  CERRADO: "gris",
};

/** El menú escucha este evento para actualizar su contador sin esperar al próximo pedido. */
export const EVENTO_PENDIENTES_PV = "encuesta-pv:pendientes";

interface Promotor {
  id: string;
  estado: Estado;
  calificadoEn: string | null;
  detectadaEn: string;
  animadoEn: string | null;
  respondioEn: string | null;
  periodo: string | null;
  sigueSiendoPromotor: boolean;
  estrellasActuales: number | null;
  notaEnRevision: boolean;
  caso: {
    id: string;
    numeroOrden: string;
    nombrePropietario: string;
    telefono: string;
    modelo: string;
    patente: string;
    asesor: string;
    sucursal: string;
    fechaServicio: string | null;
  };
}

interface RespuestaLista {
  data: Promotor[];
  resumen: { pendientes: number; animados: number; respondieron: number; cerrados?: number; total: number };
  sucursal: string | null;
  /** Los meses cerrados: un promotor de esos meses que sigue en la lista llegó tarde. */
  periodosCerrados?: Array<{ periodo: string; sucursal: string }>;
}

type SeguimientoPV = SeguimientoEncuestas & { sucursal: string | null };

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const f = new Date(iso);
  return `${String(f.getDate()).padStart(2, "0")}/${String(f.getMonth() + 1).padStart(2, "0")}/${f.getFullYear()}`;
}

/** Un número del resumen, con su etiqueta al lado. */
function Dato({ valor, etiqueta, clase }: { valor: number; etiqueta: string; clase: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 rounded-full px-3 py-1 ${clase}`}>
      <span className="text-sm font-bold tabular-nums">{valor}</span>
      <span className="text-xs">{etiqueta}</span>
    </span>
  );
}

function SelectorEstado({
  valor,
  onCambiar,
  deshabilitado,
}: {
  valor: Estado;
  onCambiar: (e: Estado) => void;
  deshabilitado?: boolean;
}) {
  // Ancho fijo: las etiquetas miden distinto y sin esto la columna queda dentada.
  return (
    <div className="inline-flex w-40">
      <Desplegable
        valor={valor}
        opciones={ESTADOS.map((e) => ({ valor: e, etiqueta: ETIQUETA_ESTADO[e], punto: PUNTO_ESTADO[e] }))}
        onCambiar={onCambiar}
        deshabilitado={deshabilitado}
        titulo="Cambiar el estado"
        className={CLASE_ESTADO[valor]}
      />
    </div>
  );
}

/** Por qué un cliente ya trabajado dejó de ser promotor, para la etiqueta de su fila. */
function etiquetaNotaActual(p: Promotor): string {
  if (p.notaEnRevision) return "nota en revisión";
  return p.estrellasActuales ? `hoy tiene ${p.estrellasActuales}★` : "hoy sin nota";
}

export default function EncuestasFabricaPV() {
  const marca = getMarca();
  // En las marcas sin la pestaña no se pide nada: alguien que entra escribiendo la
  // URL vería el aviso y, sin esto, la pantalla pediría un 404 cada minuto.
  const habilitada = marca.modulos.encuestaFabricaPV;
  // Fidelización ve esta pestaña SOLO con los gráficos: la lista le da 403.
  const soloGraficos = esSoloFidelizacion(getUsuario());

  const [lista, setLista] = useState<RespuestaLista | null>(null);
  // El motivo por el que este usuario no trabaja la lista (otra provincia, o Ventas).
  const [sinAcceso, setSinAcceso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardandoId, setGuardandoId] = useState<string | null>(null);

  // `version` sube con cada recarga de la lista, así los gráficos se refrescan
  // después de cualquier cambio de estado.
  const [version, setVersion] = useState(0);
  const [seguimiento, setSeguimiento] = useState<SeguimientoPV | null>(null);
  const [errorSeguimiento, setErrorSeguimiento] = useState(false);
  // "" = todos los meses; "SIN_MES" = los que no tienen ninguna fecha de servicio.
  const [mes, setMes] = useState("");
  const [buscar, setBuscar] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<"" | Estado>("");

  const cargar = useCallback(async () => {
    if (!habilitada) return;
    if (soloGraficos) {
      setVersion((v) => v + 1);
      setCargando(false);
      return;
    }
    try {
      const r = await apiGet<RespuestaLista>("/api/encuesta-pv");
      setLista(r);
      setSinAcceso(null);
      // El contador del menú se pone al día enseguida (por ejemplo, al marcar Primer contacto).
      window.dispatchEvent(new CustomEvent(EVENTO_PENDIENTES_PV, { detail: r.resumen.pendientes }));
    } catch (err) {
      const status = (err as { status?: number }).status;
      const mensaje = err instanceof Error ? err.message : null;
      if (status === 403) setSinAcceso(mensaje ?? "Esta lista no es de tu área o de tu provincia.");
      else setError(mensaje ?? "No pudimos cargar los promotores.");
    } finally {
      setCargando(false);
      setVersion((v) => v + 1);
    }
  }, [habilitada, soloGraficos]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Un cliente que acaba de poner 5 estrellas tiene que aparecer sin recargar la
  // página: la lista se vuelve a pedir cada minuto mientras la pestaña está abierta.
  useEffect(() => {
    if (!habilitada || soloGraficos || sinAcceso) return;
    const t = window.setInterval(() => {
      cargar();
    }, 60_000);
    return () => window.clearInterval(t);
  }, [cargar, habilitada, soloGraficos, sinAcceso]);

  useEffect(() => {
    if (!habilitada) return;
    // Una respuesta vieja (un mes elegido antes, o el refresco del minuto) que llega
    // tarde no pisa a la última.
    let vigente = true;
    const params = /^\d{4}-\d{2}$/.test(mes) ? `?periodo=${mes}` : "";
    apiGet<SeguimientoPV>(`/api/encuesta-pv/seguimiento${params}`)
      .then((r) => {
        if (!vigente) return;
        setSeguimiento(r);
        setErrorSeguimiento(false);
      })
      // Es un agregado: si falla se quedan los últimos gráficos y se avisa.
      .catch(() => {
        if (vigente) setErrorSeguimiento(true);
      });
    return () => {
      vigente = false;
    };
  }, [habilitada, mes, version]);

  // Si el mes elegido ya no existe en los gráficos que llegaron (un mes que se quedó
  // sin promotores), se vuelve a "Todos los meses". Si no, el desplegable mostraría
  // "Todos los meses" con la lista y el ranking acotados al mes viejo.
  useEffect(() => {
    if (!seguimiento || mes === "") return;
    const existe = mes === "SIN_MES" ? seguimiento.sinMes > 0 : seguimiento.meses.some((m) => m.periodo === mes);
    if (!existe) setMes("");
  }, [seguimiento, mes]);

  async function cambiarEstado(p: Promotor, estado: Estado) {
    if (estado === p.estado) return;
    setGuardandoId(p.id);
    let fallo: string | null = null;
    try {
      await apiPatchJson(`/api/encuesta-pv/clientes/${p.id}`, { estado });
    } catch (err) {
      fallo = err instanceof Error ? err.message : "No se pudo cambiar el estado.";
    }
    // Siempre se recarga: si falló porque la fila cambió (se borró, dejó de ser 5),
    // la lista tiene que mostrar lo que hay en la base y no el estado viejo.
    await cargar();
    setError(fallo);
    setGuardandoId(null);
  }

  const filtrados = useMemo(() => {
    if (!lista) return [];
    const q = buscar.trim().toLowerCase();
    return lista.data.filter((p) => {
      if (filtroEstado && p.estado !== filtroEstado) return false;
      if (mes === "SIN_MES" && p.periodo) return false;
      if (/^\d{4}-\d{2}$/.test(mes) && p.periodo !== mes) return false;
      if (!q) return true;
      return [p.caso.nombrePropietario, p.caso.patente, p.caso.numeroOrden, p.caso.asesor, p.caso.telefono, p.caso.modelo]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [lista, buscar, filtroEstado, mes]);

  if (!habilitada) {
    return <Alert tono="info">Esta pantalla no aplica en {marca.nombre}.</Alert>;
  }

  const sucursal = lista?.sucursal ?? seguimiento?.sucursal ?? "";

  const avisoGraficos = errorSeguimiento && (
    <Alert tono="advertencia">
      {seguimiento
        ? "No pudimos actualizar los gráficos: se muestran los últimos que cargaron."
        : "No pudimos cargar los gráficos. Probá de nuevo en un rato."}
    </Alert>
  );

  const bloqueSeguimiento = seguimiento && (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="pv-mes" className="text-sm font-medium text-ink">
          Mes
        </label>
        <Select id="pv-mes" value={mes} onChange={(e) => setMes(e.target.value)} className="!w-60">
          <option value="">Todos los meses</option>
          {[...seguimiento.meses].reverse().map((m) => (
            <option key={m.periodo} value={m.periodo}>
              {etiquetaMes(m.periodo)} ({m.clientes})
            </option>
          ))}
          {seguimiento.sinMes > 0 && <option value="SIN_MES">Sin mes ({seguimiento.sinMes})</option>}
        </Select>
        <span className="text-xs text-ink-muted">
          {soloGraficos || !lista
            ? "Acota el ranking de asesores."
            : "Acota el ranking de asesores y la lista de promotores de abajo."}
        </span>
      </div>

      <Card padding="p-5">
        <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy">Contactos mes a mes</h3>
        <p className="mt-1 text-sm text-ink-muted">
          Cada mes son los promotores cuyo servicio fue ese mes (la salida del taller o, si no está, la apertura de la
          orden). Un cliente cuenta como contactado desde que Calidad lo marcó en Primer contacto, aunque después haya
          respondido. Los Cerrados cuentan como contactados que no respondieron.
        </p>
        {seguimiento.meses.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            Todavía no hay promotores. Aparecen solos apenas un cliente de Posventa {sucursal} califica con 5 estrellas.
          </p>
        ) : (
          <div className="mt-4 space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="min-w-0">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Promotores por mes</h4>
                <BarrasAnimacionPorMes
                  meses={seguimiento.meses}
                  seleccionado={mes}
                  onSeleccionar={setMes}
                  textos={TEXTOS_POSVENTA}
                />
              </div>
              <div className="min-w-0">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Promotores por asesor{/^\d{4}-\d{2}$/.test(mes) ? ` · ${etiquetaMes(mes)}` : ""}
                </h4>
                <RankingVendedoresAnimacion
                  vendedores={seguimiento.vendedores}
                  minimo={seguimiento.minimoRanking}
                  textos={TEXTOS_POSVENTA}
                />
              </div>
            </div>
            <TablaAnimacionPorMes
              meses={seguimiento.meses}
              total={seguimiento.total}
              seleccionado={mes}
              textos={TEXTOS_POSVENTA}
            />
            <p className="text-xs text-ink-muted">
              «Respondieron» son los que Calidad marcó a mano. El mes en curso todavía se está trabajando.
              {seguimiento.sinMes > 0 &&
                ` ${seguimiento.sinMes} promotor(es) no tienen fecha de servicio y no entran en ningún mes.`}
            </p>
          </div>
        )}
      </Card>
    </>
  );

  if (soloGraficos) {
    return (
      <div className="space-y-4">
        <Alert tono="info">
          Ves los gráficos de los promotores de Posventa. La lista de clientes la trabaja Calidad de Posventa.
        </Alert>
        {avisoGraficos}
        {bloqueSeguimiento ?? (!errorSeguimiento && <SkeletonBlock className="h-64 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Alert tono="error">{error}</Alert>}

      <Card padding="p-5">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-navy">
          Promotores de Posventa{sucursal ? ` ${sucursal}` : ""}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Entran solos los clientes de Posventa{sucursal ? ` ${sucursal}` : ""} que calificaron con 5 estrellas: por
          WhatsApp, por llamada o con la nota corregida en Seguimiento. Contactalos para que respondan la encuesta de
          fábrica y marcá cómo va cada uno.
        </p>
        {lista && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Dato valor={lista.resumen.pendientes} etiqueta="sin contactar" clase="bg-yellow-50 text-yellow-900" />
            <Dato valor={lista.resumen.animados} etiqueta="primer contacto" clase="bg-accent-light text-accent-dark" />
            <Dato valor={lista.resumen.respondieron} etiqueta="respondieron" clase="bg-green-50 text-green-900" />
            {(lista.resumen.cerrados ?? 0) > 0 && (
              <Dato valor={lista.resumen.cerrados ?? 0} etiqueta="cerrados" clase="bg-gray-100 text-ink" />
            )}
            <Dato valor={lista.resumen.total} etiqueta="en total" clase="bg-gray-100 text-ink-muted" />
          </div>
        )}
      </Card>

      {sinAcceso && <Alert tono="info">{sinAcceso}</Alert>}

      {avisoGraficos}
      {bloqueSeguimiento}

      {cargando && !lista && !sinAcceso && <SkeletonBlock className="h-64 w-full" />}

      {lista && (
        <CierreDeMeses<Promotor>
          base="/api/encuesta-pv"
          cambio={version}
          onCambio={cargar}
          renderClientes={(promotores) => (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  <th className="px-5 py-2">Cliente</th>
                  <th className="px-3 py-2">Vehículo</th>
                  <th className="px-3 py-2">Asesor</th>
                  <th className="px-3 py-2">Servicio</th>
                  <th className="px-5 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {promotores.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="px-5 py-2">
                      <div className="font-medium text-ink">{p.caso.nombrePropietario}</div>
                      <div className="text-xs text-ink-muted">{p.caso.telefono || "sin teléfono"}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-ink">{p.caso.modelo}</div>
                      <div className="text-xs text-ink-muted">
                        {p.caso.patente} · OR {p.caso.numeroOrden}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-ink">{p.caso.asesor || "—"}</td>
                    <td className="px-3 py-2 text-ink">{fechaCorta(p.caso.fechaServicio)}</td>
                    <td className="px-5 py-2">
                      <Badge tono={TONO_ESTADO[p.estado] ?? "gris"}>{ETIQUETA_ESTADO[p.estado] ?? p.estado}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />
      )}

      {lista && (
        <Card padding="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
            <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy">
              Promotores ({filtrados.length}
              {filtrados.length !== lista.data.length ? ` de ${lista.data.length}` : ""})
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                placeholder="Buscar cliente, patente, orden, asesor…"
                aria-label="Buscar promotor"
                className="!w-72"
              />
              <Select
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value as "" | Estado)}
                aria-label="Filtrar por estado"
                className="!w-44"
              >
                <option value="">Todos los estados</option>
                {ESTADOS.map((e) => (
                  <option key={e} value={e}>
                    {ETIQUETA_ESTADO[e]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {lista.data.length === 0 ? (
            <EmptyState
              icono={Award}
              titulo="Todavía no hay promotores"
              descripcion={`Cuando un cliente de Posventa${sucursal ? ` ${sucursal}` : ""} califique con 5 estrellas, aparece acá solo.`}
            />
          ) : filtrados.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">Ningún promotor coincide con los filtros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                    <th className="px-5 py-2">Cliente</th>
                    <th className="px-3 py-2">Vehículo</th>
                    <th className="px-3 py-2">Asesor</th>
                    <th className="px-3 py-2">Servicio</th>
                    <th className="px-3 py-2">Calificó 5★</th>
                    <th className="px-5 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((p) => (
                    <tr key={p.id} className="border-b border-gray-100 align-top">
                      <td className="px-5 py-2.5">
                        <div className="font-medium text-ink">{p.caso.nombrePropietario}</div>
                        <div className="text-xs text-ink-muted">{p.caso.telefono || "sin teléfono"}</div>
                        {/* Con el prefijo "caso:", igual que el cartel de avisos: así la
                            conversación queda marcada en la lista de Seguimiento. */}
                        <Link
                          to={`/seguimiento?caso=${encodeURIComponent(`caso:${p.caso.id}`)}`}
                          className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent-dark hover:underline"
                        >
                          <MessagesSquare className="h-3 w-3" aria-hidden="true" /> Ver conversación
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-ink">{p.caso.modelo}</div>
                        <div className="text-xs text-ink-muted">
                          {p.caso.patente} · OR {p.caso.numeroOrden}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-ink">{p.caso.asesor || "—"}</td>
                      <td className="px-3 py-2.5">
                        <div className="text-ink">{fechaCorta(p.caso.fechaServicio)}</div>
                        <div className="text-xs text-ink-muted">{p.periodo ? etiquetaMes(p.periodo) : "sin mes"}</div>
                        {esDeMesCerrado(p.periodo, p.caso.sucursal, lista.periodosCerrados) && (
                          <span
                            className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                            title="Su mes ya estaba cerrado cuando entró a la lista. Trabajalo, o guardalo desde Cierre de meses."
                          >
                            MES CERRADO
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-ink">{fechaCorta(p.calificadoEn)}</div>
                        {!p.sigueSiendoPromotor && (
                          <span title="Después de entrar a esta lista la nota del caso cambió. Queda porque ya se lo había trabajado.">
                            <Badge tono="amarillo">{etiquetaNotaActual(p)}</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        <SelectorEstado
                          valor={p.estado}
                          onCambiar={(e) => cambiarEstado(p, e)}
                          deshabilitado={guardandoId === p.id}
                        />
                        {p.animadoEn && (
                          <div className="mt-1 text-[11px] text-ink-muted">primer contacto el {fechaCorta(p.animadoEn)}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
