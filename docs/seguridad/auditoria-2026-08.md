# Auditoria de seguridad - Sistema de Calidad (Ford Goldstein)

> **Fecha:** agosto 2026 - **Alcance:** codigo + despliegue local (PC Windows en LAN) - **Metodo:** 6 dimensiones auditadas en paralelo con verificacion adversarial (13 agentes). 40 hallazgos confirmados (5 altas, 14 medias, 18 bajas, 3 info); 0 falsos positivos tras verificacion.

## Resumen ejecutivo

El sistema de Calidad está, en lo esencial, bien construido: cifra las credenciales de Meta, hashea contraseñas, tiene control de acceso por rol/área/provincia, rate-limit, auditoría y backups verificados. La auditoría no encontró una puerta abierta a internet ni una fuga masiva de datos, pero sí tres puntos que conviene cerrar pronto: (1) el "buzón" por donde entran los mensajes de WhatsApp acepta mensajes sin comprobar que vengan realmente de Meta, así que otra PC de la oficina —o un script mal apuntado— podría dar de baja clientes o ensuciar los tableros; (2) si en la instalación quedó la contraseña/clave de ejemplo del sistema, alguien podría entrar como administrador; y (3) el sistema lee todos los días un Excel con una librería que tiene fallas conocidas, por lo que un archivo manipulado (aun sin mala intención) podría colgar el servicio. Ninguno deja hoy el tablero en blanco, y todas las correcciones prioritarias son de bajo riesgo y se pueden aplicar sin frenar la operación. El plan es: primero los arreglos seguros de software (validar la firma de WhatsApp, exigir claves fuertes, actualizar el lector de Excel, registrar quién exporta datos), después endurecer la PC Windows (cifrar el disco, acotar el firewall, sacar las planillas reales de la carpeta del sistema) y por último mejoras de fondo cuando haya una ventana de mantenimiento.

## Postura actual (lo que YA esta bien - no re-tocar)

Ya está bien resuelto y no debe re-tocarse: (a) Criptografía correcta — AES-256-GCM con IV aleatorio de 12 bytes por operación, auth tag verificado y blob versionado 'v1:' (cripto.service.ts), clave de 32 bytes reales; el token de Meta se cifra en base y patchMeta bloquea con 400 guardar credenciales si el cifrado no está disponible. (b) Higiene de secretos en git limpia — 36 commits, ningún .env/.sql/.xlsx real trackeado jamás, solo .example con placeholders; estadoMeta enmascara el token y seedAdmin no loguea la contraseña. (c) RBAC y aislamiento por área/provincia bien aplicados en la mayoría de módulos (refuerzo.controller usa mismaProvincia; el DELETE de las rutas exige requireAdmin). (d) SQLi/XSS/SSRF/ReDoS revisados sin hallazgo explotable: $queryRaw parametrizado con Prisma, React escapa por defecto (sin dangerouslySetInnerHTML), fetch armado desde env de confianza, regex anclados. (e) bcrypt para contraseñas, lockout de login por email (5/15min) auditado, idempotencia de webhook por waMessageId, JWT reconsulta el usuario en base. (f) Aislamiento de red Docker correcto: Postgres/Redis no publican puerto al host, sin docker.sock montado, sin privileged/cap_add/host, builds multi-stage; en el servidor corre Podman rootless. (g) mem_limit + restart:unless-stopped en el compose local acotan el OOM. (h) Backups con verificación y copia S3 condicional implementados.

## Modelo de amenazas

| Amenaza | Vector | Impacto | Mitigacion |
|---|---|---|---|
| Inyección de mensajes/estados falsos de WhatsApp desde la LAN o desde el túnel público | POST a /api/webhooks/whatsapp sin firma HMAC ni auth (montado antes de requireAuth); el campo 'from' lo controla el atacante y varía el message.id para saltar la idempotencia | Da de baja (opt-out) clientes reales, marca casos como RESPONDIDO, inyecta quejas ROJAS que abren RQR, envenena estadísticas de sentimiento, quema cuota de Gemini/Anthropic y hace crecer sin tope la tabla mensajeHuerfano (DoS de storage) | Validar X-Hub-Signature-256 con HMAC-SHA256 sobre el rawBody usando el App Secret de Meta cifrado; responder 403 si no coincide; acotar retención de mensajeHuerfano. Fail-open incremental si aún no hay App Secret cargado |
| Acceso ADMIN por credencial/secreto de ejemplo no cambiado | JWT_SECRET valida solo que no esté vacío, así que el placeholder público del repo pasa; ADMIN_PASSWORD_INICIAL queda válida indefinidamente sin cambio forzado | Forjar un JWT con rol ADMIN (jsonwebtoken lo acepta) o loguearse con la clave de arranque conocida; acceso total a todas las áreas y provincias, incluida toda la PII | Exigir en el arranque JWT_SECRET >=32 chars y rechazar placeholders (CAMBIAR/changeme/ejemplo); flag debeCambiarPassword que fuerce el cambio del admin inicial; quitar ADMIN_PASSWORD_INICIAL del .env una vez cambiada |
| Archivo Excel manipulado que cuelga o corrompe el backend | XLSX.read parsea el .xlsx/.xls subido con SheetJS 0.18.5 (prototype pollution CVE-2023-30533 + ReDoS CVE-2024-22363, sin parche en npm); la ruta de subida la alcanza cualquier usuario CALIDAD autenticado | Congela el event loop (ReDoS) o corrompe Object.prototype; el peor caso es DoS/OOM y reinicio del contenedor. Vector INVOLUNTARIO real: un reporte de la agencia/ARCA/Ford manipulado que sube Vanina/Ezequiel | Fijar la build parcheada de SheetJS desde cdn.sheetjs.com (xlsx 0.20.x, API-compatible; NO migrar a exceljs porque no lee .xls OLE2); envolver el parseo en timeout/worker; npm audit --omit=dev en CI |
| Insider en la LAN capturando sesiones sobre HTTP en claro | Todo el tráfico va por HTTP puro por IP; ARP spoofing/sniffing desde otra PC de la oficina captura el POST de login y el header Bearer | Roba la contraseña de administración/gerencia y/o el JWT (reutilizable 8h sin refresh), actuando como ese usuario | Terminar TLS en el nginx local con cert de CA interna/mkcert importado en las 2-3 PCs de gerencia (sigue siendo LAN por IP, respeta 'solo red local'); reducir JWT_EXPIRES_IN; alinear el comentario de app.ts:26 con el deploy HTTP real |
| Robo/pérdida de la notebook o acceso físico a la PC Windows | Disco sin BitLocker, puerto 80 abierto a 0.0.0.0 (toda la LAN), sin bloqueo de sesión por inactividad; planillas reales (.xls con PII) y un .env con token real en la carpeta del repo | Lectura completa del volumen de Postgres (PII de clientes), backups locales y planillas; operar el sistema en un escritorio desatendido | BitLocker XtsAes256+TPM; regla de firewall inbound TCP 80 acotada a la subred de la oficina; InactivityTimeoutSecs 600; deshabilitar RDP; cuenta estándar para el día a día; mover los .xls reales y el .env fuera de la carpeta del repo |
| Exfiltración de PII vía exportación sin rastro | GET /exportar no exige requireAdmin ni llama a auditar(); el Excel incluye WhatsApp, Celular, Email, Patente y Chasis VIN | Un usuario CALIDAD (o quien tenga su sesión abierta) baja toda la PII de su área sin dejar registro en AuditLog; ante una fuga no se sabe quién exportó qué | Agregar ACCIONES.EXPORTACION y auditar cada exportación; evaluar restringir la exportación completa de PII a ADMIN dejando reportes agregados sin PII para CALIDAD |
| Fuga de PII entre sucursales por módulo sin aislamiento | Fidelización (listar/detalle) filtra solo por tipo y eliminadoEn, sin mismaProvincia; devuelve nombre, teléfono y patente de cualquier carga | Un usuario CALIDAD restringido (p.ej. Ventas/San Juan) ve PII de otra sucursal/provincia, rompiendo la separación que respeta el resto del sistema | Decidir el modelo en docs/preguntas-abiertas.md: restringir Fidelización a ADMIN/POSVENTA o filtrar por provincia del upload con mismaProvincia, igual que refuerzo.controller |

## Hallazgos priorizados

### 1. WEBHOOK-01 - Alta

**El webhook POST de WhatsApp no valida la firma HMAC de Meta: inyección de mensajes/opt-outs/estados falsos (consolida AUTH-01, INJ-02, SEC-CRYPTO-02, PDR-01)**

- **Riesgo de romper al aplicar:** MEDIO - **Esfuerzo:** MEDIO
- **Fix:** Guardar el App Secret de Meta cifrado (mismo mecanismo que el token). Capturar rawBody solo en /api/webhooks con express.json({verify:(req,_res,buf)=>{req.rawBody=buf}}). Middleware previo a recibirWebhook que compare crypto.timingSafeEqual(HMAC-SHA256(appSecret,rawBody), x-hub-signature-256) y responda 403/401 si no coincide. Fail-open incremental si aún no hay App Secret (loguear advertencia, no cortar la entrada real); fail-closed en el deploy público. Acotar además el crecimiento de mensajeHuerfano (tope/retención) y corregir el comentario engañoso de routes/index.ts:33.

### 2. SEC-CRYPTO-01 - Alta

**El backend arranca con JWT_SECRET débil o con el placeholder público del repo (solo valida no-vacío) (consolida AUTH-03)**

- **Riesgo de romper al aplicar:** MEDIO - **Esfuerzo:** BAJO
- **Fix:** En env.ts, tras el chequeo de vacío: if (env.jwt.secret.length < 32 || /CAMBIAR|changeme|secret|password|ejemplo/i.test(env.jwt.secret)) throw new Error('JWT_SECRET débil o de ejemplo: generá uno con openssl rand -hex 32'). Aplicar el mismo bloqueo a ADMIN_PASSWORD_INICIAL. Documentar que rotar el secreto obliga a re-loguear una vez.

### 3. INJ-01 - Alta

**xlsx/SheetJS 0.18.5 con prototype pollution + ReDoS sin parche en npm: es el parser del Excel que se sube a diario (consolida CD-01)**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** MEDIO
- **Fix:** Fijar la build parcheada oficial en backend/package.json: "xlsx":"https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz" (API-compatible con read/sheet_to_json). NO migrar la lectura a exceljs: no soporta .xls OLE2 que el sistema acepta a propósito. Envolver XLSX.read en un timeout/worker aislado para acotar el ReDoS. Agregar npm audit --omit=dev como paso de CI que falle ante High/Critical.

### 4. PDR-05 - Media

**Las exportaciones de PII completa no se auditan ni exigen rol ADMIN**

- **Riesgo de romper al aplicar:** NINGUNO - **Esfuerzo:** BAJO
- **Fix:** Agregar ACCIONES.EXPORTACION al catálogo y llamar auditar(req,{accion:'EXPORTACION',entidad,detalles:{filtros,filas}}) al final de cada exportar* (casos y RQR Word). Evaluar restringir la exportación completa de PII a ADMIN, dejando reportes agregados sin PII para CALIDAD. Es el hallazgo de mejor relación valor/riesgo del set.

### 5. HDR-XSS-01 - Media

**La SPA se sirve sin cabeceras de seguridad (CSP/X-Frame-Options/nosniff); el JWT vive en localStorage**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** BAJO
- **Fix:** En frontend/nginx-prod.conf a nivel server: add_header X-Content-Type-Options nosniff always; X-Frame-Options DENY always; Referrer-Policy no-referrer always; y una CSP (default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self') probada en staging para no romper ECharts/Vite. A mediano plazo evaluar mover el JWT a cookie httpOnly+Secure+SameSite=Strict (checkpoint aparte).

### 6. AUTH-06 - Media

**Fidelización es el único módulo sin aislamiento por área/provincia: fuga de PII entre sucursales**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** MEDIO
- **Fix:** Decidir el modelo y registrarlo en docs/preguntas-abiertas.md: si Fidelización es global de Posventa, restringir sus rutas a ADMIN o a área POSVENTA; si debe seguir el patrón general, filtrar por provincia del upload con mismaProvincia(req.usuario.sucursal, upload.sucursal) en listar/detalle, igual que refuerzo.controller.

### 7. AUTH-05 - Media

**El admin inicial no obliga a cambiar la contraseña y ADMIN_PASSWORD_INICIAL queda válida indefinidamente**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** MEDIO
- **Fix:** Agregar columna debeCambiarPassword (default true en el seed del admin y en createUsuario). En requireAuth/login, si está en true, bloquear todo salvo POST /auth/cambiar-password y forzar la pantalla en el frontend; ponerla en false al cambiar. Quitar ADMIN_PASSWORD_INICIAL del .env una vez cambiada.

### 8. TLS-LAN-01 - Media

**Secretos y sesiones viajan en HTTP plano por la LAN (sniffing/ARP spoofing) (consolida AUTH-02, SEC-CRYPTO-04)**

- **Riesgo de romper al aplicar:** MEDIO - **Esfuerzo:** MEDIO
- **Fix:** Terminar TLS en el nginx local con cert autofirmado/CA interna emitido para la IP de la PC (listen 443 ssl + redirect 80->443, publicar 443 en el compose); importar el cert en las 2-3 PCs de gerencia/administración. Reducir JWT_EXPIRES_IN (hoy 8h). No viola 'solo red local'. Alinear el comentario de app.ts:26 con el deploy HTTP real.

### 9. PDR-02 - Media

**Host Windows sin endurecer: disco sin cifrar, puerto 80 abierto a toda la LAN, sin bloqueo de sesión; planillas reales y .env con token en el repo**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** MEDIO
- **Fix:** Sumar a configurar-pc.ps1 o a un checklist: BitLocker XtsAes256+TPM en C:; New-NetFirewallRule inbound TCP 80 acotada a la subred de la oficina; InactivityTimeoutSecs 600; fDenyTSConnections=1 (deshabilitar RDP); cuenta estándar en docker-users para el día a día; confirmar Defender+Windows Update. Mover los .xls reales y el .env fuera de la carpeta del repo a una ubicación cifrada.

### 10. CD-02 - Media

**El compose del servidor no define mem_limit en ningún servicio: DoS por agotamiento de memoria**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** BAJO
- **Fix:** Agregar mem_limit y cpus a cada servicio de docker-compose.yml DIMENSIONADOS a la RAM real de la VM del servidor (no copiar los valores del WSL2 de 3 GB del local). Sumar pids_limit para acotar fork-bombs. restart:unless-stopped ya presente recupera del OOM.

### 11. CD-03 - Media

**Todos los contenedores corren como root, sin no-new-privileges, cap_drop ni read-only rootfs**

- **Riesgo de romper al aplicar:** MEDIO - **Esfuerzo:** MEDIO
- **Fix:** Añadir usuario no-root en backend/Dockerfile.prod (adduser -S app; chown /app; USER app), verificando escritura en carpetas de upload temporales; usar nginxinc/nginx-unprivileged en el frontend. En ambos compose agregar por servicio security_opt:[no-new-privileges:true], cap_drop:[ALL] y read_only:true con tmpfs para /tmp y uploads. Probar migrate deploy + arranque completo.

### 12. PDR-06 - Media

**Backup sin alerta ante fallo y con copia offsite opcional (posible backup único en el mismo disco)**

- **Riesgo de romper al aplicar:** NINGUNO - **Esfuerzo:** BAJO
- **Fix:** Reutilizar el envío de mails existente para alertar cuando status.json marque ultimoBackup.ok=false o ultimaVerificacion.ok=false. Verificar en la PC real si BACKUP_S3_* están seteados; si no se quiere cloud, copiar el dump a un NAS/USB cifrado fuera de la máquina.

### 13. SEC-CRYPTO-03 - Baja

**CONFIG_ENCRYPTION_KEY no se valida al arrancar; su placeholder deja el cifrado apagado hasta el primer guardado**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** BAJO
- **Fix:** Fallar rápido al arrancar (mismo patrón que JWT_SECRET): si !cifradoDisponible() avisar fuerte 'CONFIG_ENCRYPTION_KEY ausente o inválida (32 bytes hex/base64)'. Reemplazar el placeholder inválido de .env.prod.example por vacío para que el fail-fast sea inequívoco.

### 14. BODY-01 - Baja

**Límite JSON de 10mb aplicado también al webhook público no autenticado: amplifica DoS de parseo**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** BAJO
- **Fix:** Bajar el límite JSON global a express.json({limit:'256kb'}) (los Excel van por multipart/multer, ninguna ruta legítima recibe JSON grande). Montar un express.json con límite chico específico para el webhook. Reducir client_max_body_size del path /api/webhooks/ en nginx a ~1m.

### 15. AUTH-07 - Baja

**Política de contraseñas mínima (8 caracteres, sin complejidad) y bcrypt en 10 rondas**

- **Riesgo de romper al aplicar:** NINGUNO - **Esfuerzo:** BAJO
- **Fix:** Elevar el mínimo a 10-12 caracteres y rechazar una lista corta de contraseñas comunes; opcionalmente subir RONDAS_HASH a 12 (bcrypt guarda el costo por hash, no rompe los existentes). Cambios acotados a auth.service.ts.

### 16. LOGIN-DOS-01 - Baja

**Bloqueo de login por email permite DoS dirigido de una cuenta conocida (p.ej. el admin) (consolida AUTH-08)**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** MEDIO
- **Fix:** Complementar el lockout por email con backoff incremental en vez de bloqueo binario, o exigir señal email+IP (fallos desde varias IPs); no bloquear duro al rol ADMIN o permitir desbloqueo desde otra sesión ADMIN. Exponer limpiarLoginFallidos (ya existe) en la UI de ADMIN. El canal 429 no filtra existencia de cuenta (los inexistentes también producen 429): no requiere acción por enumeración.

### 17. AUTH-04 - Baja

**jwt.verify no fuerza el algoritmo (algorithms): defensa en profundidad contra confusión de algoritmo**

- **Riesgo de romper al aplicar:** NINGUNO - **Esfuerzo:** BAJO
- **Fix:** jwt.verify(token, env.jwt.secret, { algorithms: ['HS256'] }). Una línea, sin impacto (ya se firma HS256). Blinda ante un futuro cambio de dependencia.

### 18. NGINX-01 - Baja

**nginx sin endurecer: server_tokens on (fuga de versión) y sin timeouts de request (slowloris)**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** BAJO
- **Fix:** En ambos .conf a nivel server: server_tokens off; client_header_timeout 10s; client_body_timeout 15s; send_timeout 15s; keepalive_timeout 30s. Dejar proxy_read_timeout largo solo en location /api/. En nginx-calidad.conf sumar ssl_protocols TLSv1.2 TLSv1.3 y HSTS cuando haya TLS.

### 19. CD-07 - Baja

**Vulnerabilidades transitorias con parche disponible (brace-expansion High, body-parser Low) sin actualizar**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** BAJO
- **Fix:** Ejecutar npm audit fix SIN --force (arregla brace-expansion y body-parser). NO tocar exceljs con --force: el 'fix' es un downgrade a 3.4.0 que rompería la exportación. Commitear package-lock.json y reconstruir imágenes. Agregar npm audit --omit=dev al workflow, que falle ante High/Critical.

### 20. INJ-04 - Baja

**Inyección de fórmulas (=,+,-,@) en exportaciones a Excel con datos controlados por cliente/IA**

- **Riesgo de romper al aplicar:** NINGUNO - **Esfuerzo:** BAJO
- **Fix:** Añadir neutralizarFormula() en exportacion.service.ts que anteponga un apóstrofo si el texto empieza con = + - @ TAB o CR; aplicarla a cliente, resumen, texto, comentario y error antes de addRows. Hoy ExcelJS tipa strings como t='s' (no explotable), pero deja el sistema a salvo ante una futura exportación CSV.

### 21. INJ-03 - Baja

**Sin límite de descompresión al leer el .xlsx: un zip-bomb agota la memoria del backend**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** MEDIO
- **Fix:** Antes de XLSX.read validar el !ref declarado y abortar con mensaje amigable si excede un umbral de filas/celdas; considerar lectura por streaming (exceljs WorkbookReader) para la ingesta. El mem_limit + restart ya presentes acotan el daño pero no evitan el corte momentáneo.

### 22. CD-04 - Baja

**Redis sin contraseña (requirepass) en ambos compose (defensa en profundidad)**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** BAJO
- **Fix:** Definir REDIS_PASSWORD, pasar --requirepass, actualizar REDIS_URL a redis://:${REDIS_PASSWORD}@redis:6379 y el healthcheck (redis-cli -a). Solo explotable si un contenedor del propio stack ya está comprometido (Redis no publica puerto ni está en la red externa), por eso prioridad baja.

### 23. CD-05 - Baja

**Imágenes fijadas por tag móvil (no por digest): sin garantía de inmutabilidad**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** MEDIO
- **Fix:** Fijar por digest (imagen@sha256:...) las 4 bases y las 3 imágenes propias (tag como comentario); pinnear las GitHub Actions por SHA de commit; automatizar el bump con Renovate/Dependabot para no congelar parches. Impacto principal: reproducibilidad y respuesta a incidentes.

### 24. CD-06 - Baja

**La imagen de producción del backend incluye devDependencies (typescript, tsx, @types)**

- **Riesgo de romper al aplicar:** MEDIO - **Esfuerzo:** BAJO
- **Fix:** Mover prisma a dependencies (se necesita en runtime para migrate deploy) y en la etapa runtime hacer npm ci --omit=dev (o npm prune --omit=dev y copiar el node_modules podado), verificando que quede el CLI de prisma. Reejecutar migrate deploy + arranque.

### 25. SEC-CRYPTO-05 - Baja

**Sin herramienta de rotación de CONFIG_ENCRYPTION_KEY (rotar deja ilegibles los secretos guardados)**

- **Riesgo de romper al aplicar:** NINGUNO - **Esfuerzo:** MEDIO
- **Fix:** Aprovechar el prefijo 'v1:' para rotación: aceptar CONFIG_ENCRYPTION_KEY_PREV opcional para descifrar lo viejo y re-cifrar con la nueva vía npm run rotar:cripto. Alternativamente documentar el procedimiento de recarga en RECOVERY.md. Relevante para la migración a los servidores INDEN (no perder el token de Meta al cambiar la key).

### 26. PDR-07 - Baja

**Borrado FÍSICO de entradas de la lista de supresión (opt-out) en vez de lógico**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** BAJO
- **Fix:** Mejora opcional: convertir el borrado en lógico (eliminadoEn/eliminadoPorId como en Caso/RQR y filtrar eliminadoEn:null en telefonosSuprimidos()) para poder restaurar el opt-out desde la app. La evidencia del motivo ya se preserva en AuditLog (SUPRESION_ELIMINADA con teléfono y motivo original), por eso prioridad baja.

### 27. PDR-04 - Baja

**No existe seudonimización real: el MODO_DEMO solo simula envío/IA, no anonimiza PII en detalle ni exportaciones**

- **Riesgo de romper al aplicar:** BAJO - **Esfuerzo:** MEDIO
- **Fix:** Añadir un helper de seudonimización determinista (alias estable derivado de hash de la clave sustituta + teléfono/email/patente enmascarados) aplicado en exportacion.service.ts y en el detalle cuando MODO_DEMO=true o un flag PII_OCULTA. No toca esquema y es reversible. Mejora de privacidad para demos, no vulnerabilidad.

### 28. PDR-03 - Baja

**PII inline en las tablas en vez de aislada por clave sustituta (mejora de arquitectura)**

- **Riesgo de romper al aplicar:** ALTO - **Esfuerzo:** ALTO
- **Fix:** Tratarlo como mejora de arquitectura a mediano plazo, no urgente. Paso intermedio de bajo riesgo: aplicar PDR-04 (seudonimización en la salida) y PDR-05 (auditar/rol en exportaciones). Migrar a una tabla PiiCliente por clave sustituta solo si se confirma como requisito de ESTE sistema, dado el alto impacto en importación/matching por teléfono.

### 29. INJ-05 - Info

**SSRF / XSS / ReDoS / SQLi revisados y sin hallazgo explotable (ya cubierto)**

- **Riesgo de romper al aplicar:** NINGUNO - **Esfuerzo:** BAJO
- **Fix:** Sin acción. Mantener graphBaseUrl fuera de la configuración editable por UI y conservar el escapado por defecto de React (no introducir dangerouslySetInnerHTML al renderizar resumenIA/respuestas del cliente).

### 30. SEC-CRYPTO-06 - Info

**Implementación criptográfica y manejo de .env: correctos (ya cubierto)**

- **Riesgo de romper al aplicar:** NINGUNO - **Esfuerzo:** BAJO
- **Fix:** Mantener. Al agregar el fail-fast de SEC-CRYPTO-03 conservar el formato versionado 'v1:' que ya facilita una futura rotación.

### 31. CD-08 - Info

**Buenas prácticas de contenedores/despliegue ya cubiertas (ya cubierto)**

- **Riesgo de romper al aplicar:** NINGUNO - **Esfuerzo:** BAJO
- **Fix:** Mantener. Opcional: alinear el Dockerfile dev a npm ci y sumar healthcheck al servicio web del compose del servidor. No urgente.

## Roadmap

### 1) Aplicar ya (seguro, alto valor, no rompe nada)

- WEBHOOK-01 (validar firma HMAC del webhook, con fail-open incremental si aún no hay App Secret — no corta la entrada real)
- SEC-CRYPTO-01 (exigir JWT_SECRET fuerte y rechazar placeholders en el arranque)
- INJ-01 (fijar SheetJS 0.20.x parcheado desde cdn.sheetjs.com, API-compatible)
- PDR-05 (auditar cada exportación y evaluar rol ADMIN)
- HDR-XSS-01 (headers nosniff/X-Frame-Options/Referrer-Policy/CSP en nginx)
- AUTH-04 (jwt.verify con algorithms:['HS256'])
- AUTH-07 (mínimo 10-12 chars + lista de comunes, opcional bcrypt 12)
- SEC-CRYPTO-03 (fail-fast de CONFIG_ENCRYPTION_KEY al arrancar)
- BODY-01 (bajar límite JSON global a 256kb + límite chico en webhook)
- NGINX-01 (server_tokens off + timeouts de request)
- INJ-04 (neutralizarFormula en exportaciones)
- CD-07 (npm audit fix SIN --force para brace-expansion y body-parser)

### 2) Con cuidado (requiere config/pruebas o decision de negocio)

- TLS-LAN-01 (terminar TLS local con cert de CA interna/mkcert, publicar 443 + redirect, reducir JWT_EXPIRES_IN)
- AUTH-05 (columna debeCambiarPassword + cambio forzado — migración de esquema)
- AUTH-06 (aislamiento de Fidelización por provincia/rol — requiere decisión de negocio en docs/preguntas-abiertas.md)
- CD-02 (mem_limit/cpus/pids_limit en el compose del servidor, dimensionados a la RAM real de la VM)
- CD-03 (usuario no-root, no-new-privileges, cap_drop, read_only + tmpfs — probar arranque completo)
- LOGIN-DOS-01 (backoff incremental o señal email+IP; desbloqueo ADMIN desde UI)
- INJ-03 (validar !ref/umbral de filas o lectura por streaming antes de XLSX.read)
- CD-04 (requirepass en Redis + REDIS_URL con credencial)
- CD-05 (pin por digest de imágenes y Actions por SHA)
- CD-06 (mover prisma a dependencies y npm ci --omit=dev en runtime)
- SEC-CRYPTO-05 (tooling de rotación de clave con CONFIG_ENCRYPTION_KEY_PREV — clave para la migración a INDEN)
- PDR-07 (borrado lógico de la lista de supresión)
- PDR-04 (helper de seudonimización determinista para MODO_DEMO/PII_OCULTA)
- PDR-03 (tabla PiiCliente por clave sustituta — solo si se confirma como requisito; alto impacto en importación/matching)

### 3) Operativo del host Windows (fuera del codigo)

- PDR-02 (BitLocker en C:, regla de firewall inbound TCP 80 acotada a la subred, InactivityTimeoutSecs 600, deshabilitar RDP, cuenta estándar para el día a día, Defender+Windows Update)
- PDR-02 (mover los .xls reales y el .env con token fuera de la carpeta del repo a ubicación cifrada)
- PDR-06 (alerta por mail cuando falla el backup/verificación; confirmar copia offsite a NAS/USB cifrado fuera de la máquina)
- SEC-CRYPTO-01/AUTH-05 (quitar ADMIN_PASSWORD_INICIAL y JWT_SECRET del .env de la PC una vez cambiados/rotados)
- Reemplazar los placeholders inválidos de .env.prod.example por vacío (soporta el fail-fast de JWT_SECRET y CONFIG_ENCRYPTION_KEY)
