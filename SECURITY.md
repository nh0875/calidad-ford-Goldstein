# Seguridad del Sistema de Calidad

Este documento explica, en lenguaje simple, **qué protege cada medida de seguridad** del sistema, para que sirva de referencia si en algún momento hay que auditarlo desde afuera. Está pensado para que lo entienda tanto alguien de Sistemas como alguien del área de Calidad.

El sistema ya tiene, de base, **login con usuario y contraseña (JWT)** y **tres roles**: `ADMIN` (gestiona usuarios y ve la auditoría), `CALIDAD` (todo el trabajo diario) y `FIDELIZACION` (un puesto acotado: solo la pantalla de Fidelización y el Seguimiento de esos clientes). Sobre eso se agregaron cuatro frentes de refuerzo.

> **Cómo se acota `FIDELIZACION`, y por qué así.** El resto del backend *permite
> por defecto*: solo `requireAdmin` cierra puertas y todo lo demás queda abierto a
> cualquier usuario autenticado. Con una lista negra ruta por ruta, cada endpoint
> nuevo nacería abierto para este rol sin que nadie se entere. Por eso se hace al
> revés: `acotarPorRol` (`backend/src/middlewares/auth.ts`) se monta una sola vez
> junto a `requireAuth` y solo deja pasar una **lista blanca** de rutas. Toda ruta
> que se agregue en el futuro le queda cerrada hasta que alguien la sume a mano.

---

## 1. Auditoría — quién hizo qué, cuándo y desde dónde

**Qué es.** Una bitácora (`AuditLog`) que registra automáticamente cada acción importante: inicios de sesión (exitosos y fallidos), creación/edición/cierre/eliminación de casos y RQR, envíos de campañas de WhatsApp, altas y cambios de usuarios, importaciones de Excel, y correcciones de la clasificación de la IA.

**Qué guarda cada registro.** El usuario (o "Sistema" si fue el cron), la acción, la entidad afectada, la fecha/hora, la **IP** y el navegador, y un detalle con el estado *antes/después* cuando aplica.

**Qué NUNCA guarda.** Contraseñas, tokens ni claves de API — ni siquiera parciales. El código que registra la auditoría solo pasa datos no sensibles.

**Regla clave: la bitácora es inmutable (solo se agrega, nunca se edita ni se borra).** No existe ningún endpoint ni método para modificar o eliminar registros de auditoría, **ni siquiera para un ADMIN**. Si algo quedó mal, se agrega un registro nuevo aclarándolo; el original no se toca. Esto es lo que le da valor legal/probatorio a la bitácora.

**Cómo se ve.** Pantalla `/auditoria` (solo ADMIN): tabla filtrable por usuario, acción, entidad, rango de fechas y búsqueda por IP, con el detalle expandible de cada fila. Los intentos de login fallidos y las eliminaciones se resaltan en rojo.

**Qué protege.** Permite reconstruir qué pasó ante un incidente, detectar accesos indebidos (muchos logins fallidos desde una IP) y responsabilizar acciones destructivas.

---

## 2. Recuperación ante desastres (backups)

**Qué es.** Un contenedor dedicado (`backup`) que corre solo, sin intervención:

- **Backup diario** de la base con `pg_dump`, comprimido, con **rotación de 14 días** (configurable) de copias locales.
- **Copia externa (offsite)** de ese mismo dump a un bucket S3-compatible (AWS S3, Backblaze B2 o DigitalOcean Spaces, según el endpoint que se configure). *Esto es lo crítico*: un backup que vive **solo** en el mismo servidor no sirve si el servidor se rompe o si alguien borra el volumen. La copia externa es el seguro real.
- **Verificación semanal de integridad**: toma el dump más reciente, lo **restaura en una base temporal descartable** y comprueba que tenga datos (cuenta filas de `Caso` contra un mínimo esperado). Si falla, deja un log con nivel `ERROR` para que se note. Un backup que nunca se probó restaurar no es un backup confiable.

**Cómo se controla sin entrar por SSH.** Endpoint `GET /api/sistema/estado-backup` (solo ADMIN), visible como una tarjeta en el Dashboard: muestra la fecha del último backup, si se copió afuera, y si la última verificación pasó o falló.

**Cómo se restaura todo desde cero.** Ver [RECOVERY.md](RECOVERY.md), con los comandos exactos copiables.

**Qué protege.** Que un incendio, un borrado accidental del volumen, un ransomware o un error humano no signifiquen perder los datos de Calidad. Con la copia offsite se puede levantar el sistema en un servidor nuevo.

---

## 3. Protección contra usuarios malintencionados o descuidados

- **Borrado lógico (nunca físico).** Eliminar un Caso, un RQR o una carga de Excel **no borra los datos**: los marca como eliminados (`eliminadoEn` + quién los eliminó). Dejan de aparecer en listados y reportes, pero siguen en la base y son **recuperables**. Solo un **ADMIN** puede eliminar; `CALIDAD` no. Restauración: `POST /api/admin/restaurar/:tipo/:id` (solo ADMIN).

- **Confirmación reforzada para borrar.** En el frontend, eliminar un Caso o un RQR **no** es un simple "¿Seguro? Sí/No": hay que **escribir la palabra exacta** (el número de orden del caso o el número de RQR) para habilitar el botón. Evita borrados por reflejo o por clic accidental.

- **Anti fuerza bruta en el login.** Hasta **5 intentos fallidos por email en 15 minutos**; al 5º, ese email queda **bloqueado 15 minutos**. Cada intento fallido queda en la auditoría con el email probado y la IP. Se controla por email (no por IP) para que un atacante detrás de muchas IPs no pueda seguir probando contra la misma cuenta.

- **Límite general de tráfico.** Máximo **100 requests por minuto por IP** en toda la API (configurable). Mitiga abuso y también errores de script que golpeen la API en loop. (El webhook de Meta y el healthcheck quedan exentos, porque reciben ráfagas legítimas.)

**Qué protege.** Que un error humano no destruya datos de forma irreversible, que una cuenta no se pueda reventar probando contraseñas, y que la API no se sature por abuso o por un bug de un cliente.

---

## 4. Endurecimiento general de la aplicación

- **Cabeceras de seguridad HTTP (Helmet).** Se agregan automáticamente cabeceras estándar: `X-Frame-Options` (evita que la app se embeba en un iframe ajeno — clickjacking), `X-Content-Type-Options`, `Referrer-Policy`, HSTS y una CSP restrictiva. La API solo devuelve JSON, así que una CSP estricta no rompe nada.

- **CORS restrictivo.** En producción, la API solo acepta pedidos del dominio real del frontend (variable `FRONTEND_URL`), **nunca `*`**. Detrás de nginx el frontend es del mismo origen, así que no hace falta abrir CORS a nadie más.

- **Validación de la carga de Excel.** Se acepta solo `.xlsx` de verdad: se valida la **extensión, el tipo declarado y el contenido real** (la firma de archivo ZIP que tiene todo `.xlsx`), no solo el nombre. Tope de **20 MB**. El archivo se lee en memoria y se parsea con la librería de Excel; **nunca se ejecuta ni se guarda como ejecutable**.

- **Sin secretos en los logs.** Ni los logs de la aplicación ni el campo `detalles` de la auditoría contienen jamás contraseñas, tokens ni API keys, ni parcialmente.

- **Logout efectivo del lado del servidor.** Los JWT expiran a las 8 hs. Además, al cerrar sesión el token se **revoca** (se guarda su identificador `jti` en una lista de revocados en Redis, con el mismo tiempo de vida que le quedaba al token). Así, cerrar sesión invalida el token de verdad: no alcanza con tenerlo copiado, el servidor lo rechaza. Desactivar un usuario también le corta el acceso al instante (el middleware revalida el usuario en cada request).

**Qué protege.** Reduce la superficie de ataque del navegador (iframes, orígenes cruzados), evita que suban archivos maliciosos disfrazados de Excel, y garantiza que "cerrar sesión" signifique realmente cerrar sesión.

---

## Resumen para una auditoría externa

| Frente | Medida | Dónde vive |
|---|---|---|
| Auditoría | Bitácora inmutable de acciones | modelo `AuditLog`, `services/audit.service.ts`, `/auditoria` |
| Auditoría | Solo inserción (sin update/delete) | No hay endpoints de escritura sobre `AuditLog` |
| Desastres | Backup diario + rotación 14 días | `backup/backup.sh` |
| Desastres | Copia offsite S3-compatible | `backup/backup.sh` (variables `BACKUP_S3_*`) |
| Desastres | Verificación semanal restaurando | `backup/verify-backup.sh` |
| Desastres | Estado visible sin SSH | `GET /api/sistema/estado-backup` + Dashboard |
| Usuarios | Borrado lógico + restauración (solo ADMIN) | `controllers/admin.controller.ts` |
| Usuarios | Confirmación tipeada para borrar | `components/ui/ConfirmarEliminacion.tsx` |
| Usuarios | Anti fuerza bruta (5/15min + bloqueo) | `services/login-throttle.service.ts` |
| Usuarios | Rate limit 100/min por IP | `middlewares/rateLimit.ts` |
| Hardening | Helmet (cabeceras HTTP) | `app.ts` |
| Hardening | CORS restrictivo (`FRONTEND_URL`) | `app.ts` |
| Hardening | Validación real de `.xlsx` + 20 MB | `middlewares/uploadXlsx.ts` |
| Hardening | Logout con revocación de token | `services/token-denylist.service.ts`, `middlewares/auth.ts` |

Lo único que **debe** quedar público sin restricciones adicionales es `POST /api/webhooks/whatsapp` (para que Meta pueda entregar mensajes); se protege sola con `META_WEBHOOK_VERIFY_TOKEN`.
