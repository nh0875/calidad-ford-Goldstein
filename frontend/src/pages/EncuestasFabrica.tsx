// Encuestas de fábrica de Volkswagen.
//
// Fábrica le manda la encuesta al cliente por mail y publica un Excel con los
// que todavía no la contestaron. Estos clientes NO se pueden contactar desde el
// sistema —el archivo no trae teléfono— así que el recordatorio va al VENDEDOR
// que hizo la entrega, para que los llame él.
//
// Por eso esta pantalla se organiza por vendedor y no por cliente: la unidad de
// trabajo es "a quién le mando el mail y con qué lista adentro".
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Mail, MailCheck, Pencil, UploadCloud, UserPlus } from "lucide-react";
import { apiGet, apiPatchJson, apiPostForm, apiPostJson } from "../lib/api";
import { getMarca } from "../lib/marca";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { Campo, Input } from "../components/ui/Field";
import { EmptyState } from "../components/ui/EmptyState";
import { SkeletonBlock } from "../components/ui/Skeleton";

interface Pendiente {
  id: string;
  chasis: string;
  dominio: string | null;
  nombreCliente: string;
  email: string;
  canalVentas: string | null;
  area: string | null;
  fechaEntrega: string | null;
  estado: "PENDIENTE" | "RESPONDIO";
  observacionesFabrica: string[];
}

interface Vendedor {
  id: string;
  codigo: string;
  nombre: string | null;
  email: string | null;
  sucursal: string;
  activo: boolean;
  ultimoAvisoEn: string | null;
  pendientes: Pendiente[];
}

interface Resumen {
  totalPendientes: number;
  vendedoresConPendientes: number;
  sinCorreo: number;
}

interface VistaPrevia {
  fileToken: string;
  filename: string;
  hojas: Array<{ nombre: string; sucursal: string; codigoSucursal: string | null; clientes: number; filasVacias: number }>;
  totalClientes: number;
  seDarianPorRespondidos: number;
  vendedores: Array<{ codigo: string; nombre: string | null; sucursal: string; clientes: number }>;
  vendedoresSinNombre: Array<{ codigo: string; sucursal: string; filas: number }>;
  rechazadas: Array<{ hoja: string; numeroFilaExcel: number; motivo: string }>;
  observadasPorFabrica: Array<{ hoja: string; fila: number; cliente: string; observaciones: string[] }>;
  avisos: string[];
}

interface EstadoMail {
  notificaPorMail: boolean;
  configurado: boolean;
  casilla: string | null;
}

interface ResultadoAviso {
  codigo: string;
  vendedor: string;
  email: string | null;
  pendientes: number;
  enviado: boolean;
  error: string | null;
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const f = new Date(iso);
  return `${String(f.getDate()).padStart(2, "0")}/${String(f.getMonth() + 1).padStart(2, "0")}/${f.getFullYear()}`;
}

export default function EncuestasFabrica() {
  const marca = getMarca();
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  // Casilla del sistema. Sin esto no sale ningún correo, así que se avisa ANTES
  // de que alguien apriete el botón y le vuelvan 18 errores iguales.
  const [estadoMail, setEstadoMail] = useState<EstadoMail | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([
        apiGet<{ data: Vendedor[]; resumen: Resumen }>("/api/encuesta-vw"),
        apiGet<EstadoMail>("/api/refuerzos/estado-mail").catch(() => null),
      ]);
      setVendedores(r.data);
      setResumen(r.resumen);
      setEstadoMail(m);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar las encuestas pendientes.");
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  // ---- Carga del Excel -----------------------------------------------------
  const [previa, setPrevia] = useState<VistaPrevia | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  async function subirArchivo(archivo: File) {
    setSubiendo(true);
    setError(null);
    setMensaje(null);
    setPrevia(null);
    try {
      const form = new FormData();
      form.append("archivo", archivo);
      setPrevia(await apiPostForm<VistaPrevia>("/api/encuesta-vw/preview", form));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos leer el archivo.");
    } finally {
      setSubiendo(false);
    }
  }

  async function confirmar() {
    if (!previa) return;
    setConfirmando(true);
    setError(null);
    try {
      const r = await apiPostJson<{ message: string }>("/api/encuesta-vw/confirm", { fileToken: previa.fileToken });
      setMensaje(r.message);
      setPrevia(null);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos confirmar la carga.");
    } finally {
      setConfirmando(false);
    }
  }

  // ---- Aviso por correo ----------------------------------------------------
  const [avisando, setAvisando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoAviso[] | null>(null);

  async function avisar(codigos?: string[]) {
    setAvisando(true);
    setError(null);
    setResultados(null);
    try {
      const r = await apiPostJson<{ message: string; resultados: ResultadoAviso[] }>(
        "/api/encuesta-vw/notificar",
        codigos ? { codigos } : {}
      );
      setResultados(r.resultados);
      setMensaje(r.message);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el aviso.");
    } finally {
      setAvisando(false);
    }
  }

  // ---- Edición del vendedor ------------------------------------------------
  const [editando, setEditando] = useState<string | null>(null);
  const [formNombre, setFormNombre] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [guardando, setGuardando] = useState(false);

  function abrirEdicion(v: Vendedor) {
    setEditando(v.id);
    setFormNombre(v.nombre ?? "");
    setFormEmail(v.email ?? "");
  }

  async function guardarVendedor(id: string) {
    setGuardando(true);
    setError(null);
    try {
      const r = await apiPatchJson<{ message: string }>(`/api/encuesta-vw/vendedores/${id}`, {
        nombre: formNombre.trim() || null,
        email: formEmail.trim() || null,
      });
      setMensaje(r.message);
      setEditando(null);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar el vendedor.");
    } finally {
      setGuardando(false);
    }
  }

  // ---- Alta manual ---------------------------------------------------------
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({ codigo: "", sucursal: "", nombre: "", email: "" });

  async function crearVendedor() {
    setGuardando(true);
    setError(null);
    try {
      const r = await apiPostJson<{ message: string }>("/api/encuesta-vw/vendedores", nuevo);
      setMensaje(r.message);
      setCreando(false);
      setNuevo({ codigo: "", sucursal: "", nombre: "", email: "" });
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos crear el vendedor.");
    } finally {
      setGuardando(false);
    }
  }

  const conPendientes = useMemo(
    () => vendedores.filter((v) => v.pendientes.some((p) => p.estado === "PENDIENTE")),
    [vendedores]
  );
  const sinCorreo = conPendientes.filter((v) => !v.email);

  if (!marca.modulos.encuestaFabrica) {
    return <Alert tono="info">Esta pantalla es de {marca.nombre}. En esta marca no aplica.</Alert>;
  }

  return (
    <div className="space-y-4">
      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}

      {/* Resumen + acciones */}
      <Card padding="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-navy">
              Encuestas de fábrica sin responder
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {resumen
                ? `${resumen.totalPendientes} cliente(s) pendientes, repartidos entre ${resumen.vendedoresConPendientes} vendedor(es).`
                : "Cargando…"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${claseBoton("secundario", "!py-1.5")} cursor-pointer`}>
              <UploadCloud className="h-4 w-4" />
              {subiendo ? "Leyendo…" : "Cargar Excel de fábrica"}
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={subiendo}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) subirArchivo(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              onClick={() => avisar()}
              disabled={avisando || conPendientes.length === 0 || estadoMail?.configurado === false}
              className={claseBoton("primario", "!py-1.5")}
              title={
                estadoMail?.configurado === false
                  ? "Falta configurar la casilla de correo del sistema"
                  : "Mandarle a cada vendedor la lista de sus clientes pendientes"
              }
            >
              <Mail className="h-4 w-4" /> {avisando ? "Enviando…" : "Avisar a los vendedores"}
            </button>
          </div>
        </div>

        {estadoMail?.configurado === false && (
          <div className="mt-3">
            <Alert tono="advertencia">
              El sistema todavía no tiene una casilla de correo configurada, así que no puede avisarle a nadie. Hay que
              cargar MAIL_USUARIO y MAIL_PASSWORD (una contraseña de aplicación de Google) en el archivo de entorno del
              servidor.
            </Alert>
          </div>
        )}

        {sinCorreo.length > 0 && (
          <div className="mt-3"><Alert tono="advertencia">
            {sinCorreo.length === 1
              ? `Al vendedor ${sinCorreo[0].nombre || sinCorreo[0].codigo} le falta el correo, así que no se le puede avisar.`
              : `A ${sinCorreo.length} vendedores con clientes pendientes les falta el correo, así que no se les puede avisar.`}{" "}
            Cargáselo con el lápiz de su fila.
          </Alert></div>
        )}
      </Card>

      {/* Vista previa de la carga: se muestra ANTES de tocar la base */}
      {previa && (
        <Card padding="p-5">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy">
            Antes de confirmar — {previa.filename}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-gray-200 p-3">
              <div className="text-2xl font-bold text-navy">{previa.totalClientes}</div>
              <div className="text-xs text-ink-muted">clientes en el archivo</div>
            </div>
            <div className="rounded-md border border-gray-200 p-3">
              <div className="text-2xl font-bold text-navy">{previa.vendedores.length}</div>
              <div className="text-xs text-ink-muted">vendedores distintos</div>
            </div>
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
              <div className="text-2xl font-bold text-amber-700">{previa.seDarianPorRespondidos}</div>
              <div className="text-xs text-amber-800">
                se van a dar por respondidos (estaban pendientes y ya no vienen en el archivo)
              </div>
            </div>
          </div>

          <div className="mt-3 text-sm text-ink-muted">
            {previa.hojas.map((h) => (
              <div key={h.nombre}>
                <strong>{h.sucursal}</strong> ({h.codigoSucursal ?? "sin código"}): {h.clientes} cliente(s)
                {h.filasVacias > 0 && `, ${h.filasVacias} fila(s) en blanco salteadas`}
              </div>
            ))}
          </div>

          {previa.vendedoresSinNombre.length > 0 && (
            <div className="mt-3"><Alert tono="advertencia">
              Hay {previa.vendedoresSinNombre.length} código(s) de vendedor que no figuran en la hoja de nombres:{" "}
              {previa.vendedoresSinNombre.map((v) => `${v.codigo} (${v.filas})`).join(", ")}. Se cargan igual y les
              podés poner nombre y correo desde la lista de abajo.
            </Alert></div>
          )}
          {previa.rechazadas.length > 0 && (
            <div className="mt-3"><Alert tono="error">
              {previa.rechazadas.length} fila(s) no se van a importar:{" "}
              {previa.rechazadas.slice(0, 5).map((r) => `${r.hoja} fila ${r.numeroFilaExcel} (${r.motivo})`).join("; ")}
              {previa.rechazadas.length > 5 && ` y ${previa.rechazadas.length - 5} más`}.
            </Alert></div>
          )}
          {previa.observadasPorFabrica.length > 0 && (
            <div className="mt-3"><Alert tono="advertencia">
              Fábrica observó {previa.observadasPorFabrica.length} fila(s) (mail inválido, chasis repetido u otro). Se
              importan igual, pero conviene revisarlas.
            </Alert></div>
          )}
          {previa.avisos.map((a, i) => (
            <div key={i} className="mt-3">
              <Alert tono="advertencia">{a}</Alert>
            </div>
          ))}

          <div className="mt-4 flex gap-2">
            <button onClick={confirmar} disabled={confirmando} className={claseBoton("primario")}>
              {confirmando ? "Cargando…" : "Confirmar la carga"}
            </button>
            <button onClick={() => setPrevia(null)} disabled={confirmando} className={claseBoton("secundario")}>
              Cancelar
            </button>
          </div>
        </Card>
      )}

      {/* Resultado del envío de correos */}
      {resultados && resultados.length > 0 && (
        <Card padding="p-5">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy">Resultado del aviso</h3>
          <div className="mt-2 space-y-1 text-sm">
            {resultados.map((r) => (
              <div key={r.codigo} className="flex flex-wrap items-center gap-2">
                <Badge tono={r.enviado ? "verde" : "rojo"}>{r.enviado ? "enviado" : "no salió"}</Badge>
                <span className="font-medium">{r.vendedor}</span>
                <span className="text-ink-muted">
                  {r.email || "sin correo"} — {r.pendientes} cliente(s)
                </span>
                {r.error && <span className="text-rojo">{r.error}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Vendedores */}
      <Card padding="p-0">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-navy">Vendedores</h3>
          <button onClick={() => setCreando((v) => !v)} className={claseBoton("secundario", "!py-1.5")}>
            <UserPlus className="h-4 w-4" /> Agregar a mano
          </button>
        </div>

        {creando && (
          <div className="grid gap-3 border-b border-gray-200 bg-gray-50 p-5 sm:grid-cols-4">
            <Campo etiqueta="Código" hint="7 dígitos: 4 de sucursal + 3 del vendedor">
              <Input value={nuevo.codigo} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })} placeholder="1035017" />
            </Campo>
            <Campo etiqueta="Sucursal">
              <Input value={nuevo.sucursal} onChange={(e) => setNuevo({ ...nuevo, sucursal: e.target.value })} placeholder="MENDOZA" />
            </Campo>
            <Campo etiqueta="Nombre">
              <Input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
            </Campo>
            <Campo etiqueta="Correo">
              <Input value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} type="email" />
            </Campo>
            <div className="sm:col-span-4">
              <button onClick={crearVendedor} disabled={guardando} className={claseBoton("primario")}>
                {guardando ? "Guardando…" : "Crear vendedor"}
              </button>
            </div>
          </div>
        )}

        {cargando ? (
          <div className="space-y-2 p-5">
            <SkeletonBlock className="h-10 w-full" />
            <SkeletonBlock className="h-10 w-full" />
            <SkeletonBlock className="h-10 w-full" />
          </div>
        ) : vendedores.length === 0 ? (
          <EmptyState
            icono={MailCheck}
            titulo="Todavía no cargaste ningún Excel de fábrica"
            descripcion="Subí el archivo de encuestas pendientes que baja de la plataforma de Volkswagen. Los vendedores se cargan solos a partir de ahí."
          />
        ) : (
          <div className="divide-y divide-gray-100">
            {vendedores.map((v) => {
              const pendientes = v.pendientes.filter((p) => p.estado === "PENDIENTE");
              const abierto = abiertos.has(v.id);
              return (
                <div key={v.id}>
                  <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <button
                      onClick={() =>
                        setAbiertos((s) => {
                          const n = new Set(s);
                          n.has(v.id) ? n.delete(v.id) : n.add(v.id);
                          return n;
                        })
                      }
                      className="flex items-center gap-2 text-left"
                      disabled={pendientes.length === 0}
                    >
                      {pendientes.length > 0 ? (
                        abierto ? (
                          <ChevronDown className="h-4 w-4 text-ink-muted" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-ink-muted" />
                        )
                      ) : (
                        <span className="w-4" />
                      )}
                      <span className="font-medium text-ink">{v.nombre || `Vendedor ${v.codigo}`}</span>
                    </button>
                    <span className="font-mono text-xs text-ink-muted">{v.codigo}</span>
                    <Badge tono="gris">{v.sucursal}</Badge>
                    <Badge tono={pendientes.length > 0 ? "amarillo" : "verde"}>
                      {pendientes.length} pendiente{pendientes.length === 1 ? "" : "s"}
                    </Badge>

                    {editando === v.id ? (
                      <div className="flex flex-1 flex-wrap items-end gap-2">
                        <Campo etiqueta="Nombre">
                          <Input value={formNombre} onChange={(e) => setFormNombre(e.target.value)} />
                        </Campo>
                        <Campo etiqueta="Correo">
                          <Input value={formEmail} onChange={(e) => setFormEmail(e.target.value)} type="email" />
                        </Campo>
                        <button onClick={() => guardarVendedor(v.id)} disabled={guardando} className={claseBoton("primario", "!py-1.5")}>
                          Guardar
                        </button>
                        <button onClick={() => setEditando(null)} className={claseBoton("secundario", "!py-1.5")}>
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className={`flex-1 text-sm ${v.email ? "text-ink-muted" : "text-rojo"}`}>
                          {v.email || (
                            <span className="inline-flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5" /> falta el correo
                            </span>
                          )}
                        </span>
                        {v.ultimoAvisoEn && (
                          <span className="text-xs text-ink-muted">último aviso {fechaCorta(v.ultimoAvisoEn)}</span>
                        )}
                        <button onClick={() => abrirEdicion(v)} className={claseBoton("secundario", "!py-1 !px-2")} title="Editar nombre y correo">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {pendientes.length > 0 && v.email && (
                          <button
                            onClick={() => avisar([v.codigo])}
                            disabled={avisando || estadoMail?.configurado === false}
                            className={claseBoton("secundario", "!py-1 !px-2")}
                            title="Avisarle solo a este vendedor"
                          >
                            <Mail className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {abierto && pendientes.length > 0 && (
                    <div className="overflow-x-auto bg-gray-50 px-5 pb-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                            <th className="py-2 pr-4">Cliente</th>
                            <th className="py-2 pr-4">Correo</th>
                            <th className="py-2 pr-4">Dominio</th>
                            <th className="py-2 pr-4">Canal</th>
                            <th className="py-2 pr-4">Entrega</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pendientes.map((p) => (
                            <tr key={p.id} className="border-t border-gray-200">
                              <td className="py-2 pr-4">
                                {p.nombreCliente}
                                {p.observacionesFabrica.length > 0 && (
                                  <span className="ml-2 text-xs text-amber-700" title={p.observacionesFabrica.join(" · ")}>
                                    (observado por fábrica)
                                  </span>
                                )}
                              </td>
                              <td className="py-2 pr-4 text-ink-muted">{p.email}</td>
                              <td className="py-2 pr-4 font-mono text-xs">{p.dominio || "—"}</td>
                              <td className="py-2 pr-4 text-ink-muted">{p.canalVentas || "—"}</td>
                              <td className="py-2 pr-4 text-ink-muted">{fechaCorta(p.fechaEntrega)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
