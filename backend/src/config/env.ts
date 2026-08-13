import "dotenv/config";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  // Correo saliente (SMTP). Lo usa el Refuerzo de Volkswagen para mandarle a
  // cada vendedor sus clientes asignados. Con Gmail/Workspace, MAIL_PASSWORD
  // tiene que ser una CONTRASEÑA DE APLICACIÓN, no la de la cuenta.
  mail: {
    host: process.env.MAIL_HOST ?? "smtp.gmail.com",
    puerto: Number(process.env.MAIL_PUERTO ?? 465),
    usuario: process.env.MAIL_USUARIO ?? "",
    password: process.env.MAIL_PASSWORD ?? "",
  },
  meta: {
    token: process.env.META_WHATSAPP_TOKEN ?? "",
    phoneNumberId: process.env.META_PHONE_NUMBER_ID ?? "",
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? "",
    // Plantilla de contacto POSVENTA (Contacto Posventa). Cada área usa la suya.
    templateName: process.env.META_TEMPLATE_NAME ?? "contacto_posventa",
    templateLang: process.env.META_TEMPLATE_LANG ?? "es_AR",
    // Plantilla de contacto VENTAS (Contacto Ventas). Un caso de Ventas se
    // contacta con ESTA, no con la de posventa. El idioma por defecto es el mismo
    // que la de posventa; se puede ajustar por separado en Configuración.
    templateVentaName: process.env.META_TEMPLATE_VENTA_NAME ?? "contacto_venta",
    // Plantilla del recordatorio de Fidelización (Parte C). Pendiente de
    // aprobación en Meta: cuando se apruebe, ya sale.
    fidelizacionTemplateName: process.env.META_FIDELIZACION_TEMPLATE_NAME ?? "fidelizacion_posventa",
    // Plantilla de recuperación: "no nos llegó tu mensaje, ¿lo repetís?" — para
    // respuestas perdidas/huérfanas. Se elige a mano desde Seguimiento.
    respuestaNoRecibidaName: process.env.META_RESPUESTA_NO_RECIBIDA_NAME ?? "respuesta_no_recibida",
    respuestaNoRecibidaLang: process.env.META_RESPUESTA_NO_RECIBIDA_LANG ?? "es_AR",
    graphBaseUrl: process.env.META_GRAPH_BASE_URL ?? "https://graph.facebook.com/v20.0",
  },
  whatsappEnvioDelayMs: Number(process.env.WHATSAPP_ENVIO_DELAY_MS ?? 2500),
  diasSinRespuestaParaNC: Number(process.env.DIAS_SIN_RESPUESTA_PARA_NC ?? 5),
  // Ventana horaria y tope diario de envíos de WhatsApp (protección para no
  // molestar clientes fuera de hora ni saturar Meta). Horas en zona AR.
  maxEnviosDiarios: Number(process.env.MAX_ENVIOS_DIARIOS ?? 200),
  horaInicioEnvio: process.env.HORA_INICIO_ENVIO ?? "09:00",
  horaFinEnvio: process.env.HORA_FIN_ENVIO ?? "19:00",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  // Proveedor alternativo de IA (opcional): si hay key de Gemini y no de Anthropic,
  // el análisis usa Gemini de verdad (vía REST, sin dependencia extra).
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  // gemini-2.5-flash: modelo estable con cupo también en proyectos de Cloud Console
  // (gemini-2.0-flash tiene free_tier limit 0 en esas keys). El thinking se
  // desactiva para salida JSON en sentiment.service.
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  // Fuerza qué proveedor usar: "gemini" | "anthropic". Vacío = automático
  // (usa el que tenga key, prefiriendo Anthropic). Solo aplica si hay key real.
  aiProvider: (process.env.AI_PROVIDER ?? "").toLowerCase().trim(),
  analisisModoMock: (process.env.ANALISIS_MODO_MOCK ?? "false").toLowerCase() === "true",
  // Tope de análisis por minuto (rate limiter de BullMQ), para no pasar el RPM
  // del free tier de Gemini. Los jobs que exceden esperan en cola, no fallan.
  analisisMaxPorMinuto: Number(process.env.ANALISIS_MAX_POR_MINUTO ?? 8),
  // MODO DEMO: muestra el sistema de punta a punta sin credenciales reales.
  // Simula el envío de WhatsApp y, si NO hay ninguna key de IA real (Anthropic
  // ni Gemini), también simula el análisis. NO cambia nada si está en false.
  modoDemo: (process.env.MODO_DEMO ?? "false").toLowerCase() === "true",
  // Parte A: demora del agradecimiento tras el ÚLTIMO mensaje del cliente
  // (deliberada, para que la conversación no se sienta automatizada). Default 3 min.
  delayAgradecimientoMs: Number(process.env.DELAY_AGRADECIMIENTO_MS ?? 180000),
  // Ventana de consolidación: cuánto se espera SIN mensajes nuevos del cliente
  // antes de analizar. Cada mensaje que llega reinicia la cuenta, así una
  // respuesta partida en varios mensajes se analiza junta y una sola vez.
  delayAnalisisMs: Number(process.env.DELAY_ANALISIS_MS ?? 90000),
  // CORS: dominio(s) del frontend de producción, separados por coma. Vacío en
  // desarrollo (se refleja el origen); en producción, si queda vacío, solo
  // funcionan las llamadas del mismo origen (que es el caso normal detrás de nginx).
  frontendUrl: process.env.FRONTEND_URL ?? "",
  // Tope de requests por minuto por IP para toda la API (mitiga abuso y loops de script).
  rateLimitPorMinuto: Number(process.env.RATE_LIMIT_POR_MINUTO ?? 100),
  // Tope aparte y holgado para /webhooks: Meta entrega en ráfagas, así que el
  // límite es alto y solo corta un pico anómalo o un loop, sin frenar a Meta.
  rateLimitWebhookPorMinuto: Number(process.env.RATE_LIMIT_WEBHOOK_POR_MINUTO ?? 600),
  // Archivo JSON de estado del backup, escrito por el contenedor de backup y
  // leído por el endpoint /api/sistema/estado-backup (volumen compartido).
  backupStatusFile: process.env.BACKUP_STATUS_FILE ?? "/var/backup-status/status.json",
  // Clave para cifrar secretos guardados en la tabla Configuracion (credenciales
  // de Meta cargadas desde /configuracion). 32 bytes en hex (64 chars) o base64.
  // Generar con: openssl rand -hex 32. OJO: si la rotás, los secretos ya
  // guardados quedan ilegibles y hay que volver a cargarlos.
  configEncryptionKey: process.env.CONFIG_ENCRYPTION_KEY ?? "",
  jwt: {
    secret: process.env.JWT_SECRET ?? "",
    expiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  },
  admin: {
    email: (process.env.ADMIN_EMAIL ?? "").toLowerCase().trim(),
    passwordInicial: process.env.ADMIN_PASSWORD_INICIAL ?? "",
  },
};

// Sin JWT_SECRET no hay forma segura de firmar tokens: mejor fallar rápido al
// arrancar que emitir sesiones firmadas con un secreto vacío o adivinable.
if (!env.jwt.secret) {
  throw new Error(
    "Falta la variable de entorno JWT_SECRET. Generá una cadena aleatoria larga (ej: `openssl rand -hex 32`) y configurala antes de iniciar el backend."
  );
}
