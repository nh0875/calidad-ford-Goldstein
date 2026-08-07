// Configuración del sistema. Por ahora: "Mensajes automáticos" (Parte A) — los
// textos del agradecimiento/recordatorio de encuesta, editables por ADMIN, con
// vista previa. Los placeholders {nombre} {email} {modelo} se reemplazan solos.
import { useCallback, useEffect, useState } from "react";
import { MessageCircleHeart, MessageSquare, Plug, Save } from "lucide-react";
import { apiGet, apiPatchJson, apiPostJson } from "../lib/api";
import { getUsuario } from "../lib/auth";
import { Card } from "../components/ui/Card";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { claseBoton } from "../components/ui/Button";
import { Campo, Input, Textarea } from "../components/ui/Field";
import { SkeletonBlock } from "../components/ui/Skeleton";

const K = {
  VERDE_AMARILLO: "agradecimiento.textoVerdeAmarillo",
  ROJO: "agradecimiento.textoRojo",
  ENVIAR_A_ROJOS: "agradecimiento.enviarARojos",
  // Fidelización: respuesta al 3er botón ("Agendar mi Turno con un Asesor").
  FIDEL_RESPUESTA: "fidelizacion.respuestaBotonAsesor",
  FIDEL_ENVIAR: "fidelizacion.enviarRespuestaBotonAsesor",
  FIDEL_BOTON_TEXTO: "fidelizacion.textoBotonAsesor",
};

// Cliente de ejemplo para la vista previa (mismos reemplazos que el backend)
function previsualizar(texto: string, opts: { conEmail: boolean }): string {
  return texto
    .replaceAll("{nombre}", "Lucía")
    .replaceAll("{email}", opts.conEmail ? "lucia.fernandez@gmail.com" : "de correo registrada en Ford")
    .replaceAll("{modelo}", "Ford Ranger");
}

export default function Configuracion() {
  const esAdmin = getUsuario()?.rol === "ADMIN";
  const [cfg, setCfg] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const { data } = await apiGet<{ data: Record<string, string> }>("/api/configuracion");
      setCfg(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar la configuración.");
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function set(clave: string, valor: string) {
    setCfg((prev) => (prev ? { ...prev, [clave]: valor } : prev));
  }

  async function guardar() {
    if (!cfg) return;
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      const { message } = await apiPatchJson<{ message: string }>("/api/configuracion", {
        [K.VERDE_AMARILLO]: cfg[K.VERDE_AMARILLO],
        [K.ROJO]: cfg[K.ROJO],
        [K.ENVIAR_A_ROJOS]: cfg[K.ENVIAR_A_ROJOS],
        [K.FIDEL_RESPUESTA]: cfg[K.FIDEL_RESPUESTA],
        [K.FIDEL_ENVIAR]: cfg[K.FIDEL_ENVIAR],
        [K.FIDEL_BOTON_TEXTO]: cfg[K.FIDEL_BOTON_TEXTO],
      });
      setMensaje(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar la configuración.");
    } finally {
      setGuardando(false);
    }
  }

  if (!cfg) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <SkeletonBlock className="h-10 w-64" />
        <SkeletonBlock className="h-48 w-full" />
      </div>
    );
  }

  const enviarARojos = cfg[K.ENVIAR_A_ROJOS] === "true";
  const fidelEnviar = cfg[K.FIDEL_ENVIAR] === "true";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}
      {!esAdmin && (
        <Alert tono="info">Solo un administrador puede editar estos textos. Los ves en modo lectura.</Alert>
      )}

      <Card padding="p-5">
        <h3 className="mb-1 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-navy">
          <MessageCircleHeart className="h-4 w-4 text-accent" aria-hidden="true" />
          Mensajes automáticos
        </h3>
        <p className="mb-4 text-xs text-ink-muted">
          Se envían por WhatsApp unos minutos después de que el cliente responde, según cómo se clasificó su
          mensaje. Podés usar los comodines{" "}
          <code className="rounded bg-gray-100 px-1">{"{nombre}"}</code>,{" "}
          <code className="rounded bg-gray-100 px-1">{"{email}"}</code> y{" "}
          <code className="rounded bg-gray-100 px-1">{"{modelo}"}</code>, que se reemplazan por los datos del
          cliente.
        </p>

        {/* VERDE / AMARILLO */}
        <div className="mb-5">
          <label className="mb-1 block text-sm font-medium text-ink">
            Cliente conforme o con objeción menor (semáforo verde / amarillo)
          </label>
          <Textarea
            value={cfg[K.VERDE_AMARILLO]}
            onChange={(e) => set(K.VERDE_AMARILLO, e.target.value)}
            rows={4}
            disabled={!esAdmin}
          />
          <Previews texto={cfg[K.VERDE_AMARILLO]} />
        </div>

        {/* ROJO */}
        <div className="mb-2 border-t border-gray-100 pt-4">
          <label className="mb-1 block text-sm font-medium text-ink">
            Cliente disconforme (semáforo rojo) — variante empática, sin recordatorio de encuesta
          </label>
          <Textarea
            value={cfg[K.ROJO]}
            onChange={(e) => set(K.ROJO, e.target.value)}
            rows={3}
            disabled={!esAdmin || !enviarARojos}
          />
          <Previews texto={cfg[K.ROJO]} />
          <label className="mt-3 flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-accent"
              checked={enviarARojos}
              disabled={!esAdmin}
              onChange={(e) => set(K.ENVIAR_A_ROJOS, e.target.checked ? "true" : "false")}
            />
            Enviar el mensaje empático a los clientes disconformes
            <span className="text-xs text-ink-muted">
              (si lo desactivás, a los rojos no se les manda ningún mensaje automático)
            </span>
          </label>
        </div>

        {/* FIDELIZACIÓN — respuesta al 3er botón de la plantilla */}
        <div className="mb-2 border-t border-gray-100 pt-4">
          <label className="mb-1 block text-sm font-medium text-ink">
            Fidelización — respuesta al botón “Agendar mi Turno con un Asesor”
          </label>
          <p className="mb-2 text-xs text-ink-muted">
            Cuando el cliente toca ese botón en el recordatorio de service, el sistema le responde este mensaje y lo
            deja marcado como <strong>“quiere turno con asesor”</strong> en Seguimiento para que lo agenden.
          </p>
          <Textarea
            value={cfg[K.FIDEL_RESPUESTA] ?? ""}
            onChange={(e) => set(K.FIDEL_RESPUESTA, e.target.value)}
            rows={3}
            disabled={!esAdmin || !fidelEnviar}
          />
          <Previews texto={cfg[K.FIDEL_RESPUESTA] ?? ""} />
          <label className="mt-3 flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-accent"
              checked={fidelEnviar}
              disabled={!esAdmin}
              onChange={(e) => set(K.FIDEL_ENVIAR, e.target.checked ? "true" : "false")}
            />
            Responder automáticamente al apretar el botón
            <span className="text-xs text-ink-muted">
              (si lo desactivás, igual queda marcado como “quiere asesor”, pero no se le manda mensaje)
            </span>
          </label>
          <div className="mt-3">
            <Campo
              etiqueta="Texto EXACTO del botón en Meta"
              hint="Tiene que coincidir con el título del botón en la plantilla. Por defecto: Agendar mi Turno con un Asesor."
            >
              <Input
                type="text"
                value={cfg[K.FIDEL_BOTON_TEXTO] ?? ""}
                onChange={(e) => set(K.FIDEL_BOTON_TEXTO, e.target.value)}
                disabled={!esAdmin}
              />
            </Campo>
          </div>
        </div>

        {esAdmin && (
          <div className="mt-5 flex justify-end">
            <button onClick={guardar} disabled={guardando} className={claseBoton("primario")}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {guardando ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        )}
      </Card>

      <SeccionWhatsapp esAdmin={esAdmin} />
    </div>
  );
}

// ---------- Credenciales de WhatsApp (Meta) ----------

interface EstadoMeta {
  cifradoDisponible: boolean;
  tokenConfigurado: boolean;
  tokenPista: string | null;
  phoneNumberId: string;
  verifyTokenConfigurado: boolean;
  templateName: string;
  templateLang: string;
  templateVentaName: string;
  templateVentaLang: string;
  fidelizacionTemplateName: string;
  fidelizacionTemplateLang: string;
  respuestaNoRecibidaName: string;
  respuestaNoRecibidaLang: string;
  completo: boolean;
}

function SeccionWhatsapp({ esAdmin }: { esAdmin: boolean }) {
  const [estado, setEstado] = useState<EstadoMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [prueba, setPrueba] = useState<{ ok: boolean; detalle: string } | null>(null);

  // Campos editables (token/verify se dejan vacíos = no cambiar)
  const [token, setToken] = useState("");
  const [verify, setVerify] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateLang, setTemplateLang] = useState("");
  const [templateVentaName, setTemplateVentaName] = useState("");
  const [templateVentaLang, setTemplateVentaLang] = useState("");
  const [fidelizacionTemplateName, setFidelizacionTemplateName] = useState("");
  const [fidelizacionTemplateLang, setFidelizacionTemplateLang] = useState("");
  const [respuestaNoRecibidaName, setRespuestaNoRecibidaName] = useState("");
  const [respuestaNoRecibidaLang, setRespuestaNoRecibidaLang] = useState("");

  const cargar = useCallback(async () => {
    try {
      const { data } = await apiGet<{ data: EstadoMeta }>("/api/configuracion/whatsapp");
      setEstado(data);
      setPhoneNumberId(data.phoneNumberId);
      setTemplateName(data.templateName);
      setTemplateLang(data.templateLang);
      setTemplateVentaName(data.templateVentaName);
      setTemplateVentaLang(data.templateVentaLang);
      setFidelizacionTemplateName(data.fidelizacionTemplateName);
      setFidelizacionTemplateLang(data.fidelizacionTemplateLang);
      setRespuestaNoRecibidaName(data.respuestaNoRecibidaName);
      setRespuestaNoRecibidaLang(data.respuestaNoRecibidaLang);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos cargar la configuración de WhatsApp.");
    }
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      const body: Record<string, string> = {
        phoneNumberId,
        templateName,
        templateLang,
        templateVentaName,
        templateVentaLang,
        fidelizacionTemplateName,
        fidelizacionTemplateLang,
        respuestaNoRecibidaName,
        respuestaNoRecibidaLang,
      };
      if (token.trim()) body.token = token.trim();
      if (verify.trim()) body.webhookVerifyToken = verify.trim();
      const r = await apiPatchJson<{ message: string; data: EstadoMeta }>("/api/configuracion/whatsapp", body);
      setMensaje(r.message);
      setEstado(r.data);
      setToken("");
      setVerify("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar las credenciales.");
    } finally {
      setGuardando(false);
    }
  }

  async function probar() {
    setProbando(true);
    setPrueba(null);
    try {
      const r = await apiPostJson<{ ok: boolean; detalle: string }>("/api/configuracion/whatsapp/probar", {});
      setPrueba(r);
    } catch (err) {
      setPrueba({ ok: false, detalle: err instanceof Error ? err.message : "Error al probar la conexión." });
    } finally {
      setProbando(false);
    }
  }

  if (!estado) return <SkeletonBlock className="h-48 w-full" />;

  return (
    <Card padding="p-5">
      <h3 className="mb-1 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-navy">
        <MessageSquare className="h-4 w-4 text-accent" aria-hidden="true" />
        WhatsApp (Meta)
        {estado.completo ? <Badge tono="verde">configurado</Badge> : <Badge tono="amarillo">incompleto</Badge>}
      </h3>
      <p className="mb-4 text-xs text-ink-muted">
        Credenciales de la API de WhatsApp de Meta. El token y el verify token se guardan <strong>cifrados</strong>.
        Cargalos cuando Meta los emita; para no cambiar el token, dejá su campo vacío.
      </p>

      {error && <Alert tono="error">{error}</Alert>}
      {mensaje && <Alert tono="exito">{mensaje}</Alert>}
      {!estado.cifradoDisponible && (
        <Alert tono="advertencia">
          No hay <code>CONFIG_ENCRYPTION_KEY</code> válida en el servidor: no se puede guardar el token cifrado hasta configurarla.
        </Alert>
      )}
      {!esAdmin && <Alert tono="info">Solo un administrador puede editar estas credenciales.</Alert>}

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Token de acceso (Meta)" hint={estado.tokenConfigurado ? `Configurado (${estado.tokenPista}). Dejalo vacío para no cambiarlo.` : "Todavía no configurado."}>
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={estado.tokenConfigurado ? "•••••••• (sin cambios)" : "Pegá el token"} disabled={!esAdmin} autoComplete="off" />
        </Campo>
        <Campo etiqueta="Phone number ID">
          <Input type="text" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} disabled={!esAdmin} />
        </Campo>
        <Campo etiqueta="Verify token del webhook" hint={estado.verifyTokenConfigurado ? "Configurado. Dejalo vacío para no cambiarlo." : "Todavía no configurado."}>
          <Input type="password" value={verify} onChange={(e) => setVerify(e.target.value)} placeholder={estado.verifyTokenConfigurado ? "•••••••• (sin cambios)" : "Elegí un token aleatorio"} disabled={!esAdmin} autoComplete="off" />
        </Campo>
        <Campo etiqueta="Plantilla de contacto POSVENTA" hint="A los casos de Posventa se les manda ESTA.">
          <Input type="text" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="contacto_posventa" disabled={!esAdmin} />
        </Campo>
        <Campo etiqueta="Idioma (posventa)">
          <Input type="text" value={templateLang} onChange={(e) => setTemplateLang(e.target.value)} placeholder="es_AR" disabled={!esAdmin} />
        </Campo>
        <Campo etiqueta="Plantilla de contacto VENTAS" hint="A los casos de Ventas se les manda ESTA.">
          <Input type="text" value={templateVentaName} onChange={(e) => setTemplateVentaName(e.target.value)} placeholder="contacto_venta" disabled={!esAdmin} />
        </Campo>
        <Campo etiqueta="Idioma (ventas)">
          <Input type="text" value={templateVentaLang} onChange={(e) => setTemplateVentaLang(e.target.value)} placeholder="es" disabled={!esAdmin} />
        </Campo>
        <Campo etiqueta="Plantilla de Fidelización">
          <Input type="text" value={fidelizacionTemplateName} onChange={(e) => setFidelizacionTemplateName(e.target.value)} placeholder="fidelizacion_posventa" disabled={!esAdmin} />
        </Campo>
        <Campo etiqueta="Idioma (fidelización)">
          <Input type="text" value={fidelizacionTemplateLang} onChange={(e) => setFidelizacionTemplateLang(e.target.value)} placeholder="es" disabled={!esAdmin} />
        </Campo>
        <Campo etiqueta="Plantilla “no nos llegó tu mensaje”" hint="Para pedirle al cliente que repita una respuesta que se perdió. Tiene que ser de TEXTO FIJO (sin variables {{1}}), igual que las de contacto.">
          <Input type="text" value={respuestaNoRecibidaName} onChange={(e) => setRespuestaNoRecibidaName(e.target.value)} placeholder="respuesta_no_recibida" disabled={!esAdmin} />
        </Campo>
        <Campo etiqueta="Idioma (no recibida)">
          <Input type="text" value={respuestaNoRecibidaLang} onChange={(e) => setRespuestaNoRecibidaLang(e.target.value)} placeholder="es_AR" disabled={!esAdmin} />
        </Campo>
      </div>

      {prueba && (
        <div className="mt-3">
          <Alert tono={prueba.ok ? "exito" : "error"}>{prueba.detalle}</Alert>
        </div>
      )}

      {esAdmin && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button onClick={probar} disabled={probando} className={claseBoton("secundario")}>
            <Plug className="h-4 w-4" aria-hidden="true" />
            {probando ? "Probando…" : "Probar conexión"}
          </button>
          <button onClick={guardar} disabled={guardando} className={claseBoton("primario")}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {guardando ? "Guardando…" : "Guardar credenciales"}
          </button>
        </div>
      )}
    </Card>
  );
}

function Previews({ texto }: { texto: string }) {
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <Preview titulo="Vista previa (con email)" texto={previsualizar(texto, { conEmail: true })} />
      <Preview titulo="Vista previa (cliente sin email)" texto={previsualizar(texto, { conEmail: false })} />
    </div>
  );
}

function Preview({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-md border border-gray-100 bg-canvas p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{titulo}</div>
      <div className="whitespace-pre-wrap text-xs text-ink">{texto}</div>
    </div>
  );
}
