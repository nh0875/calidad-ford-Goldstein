# Servidor OVHcloud — Sistema de Calidad (Ford + Volkswagen)

Las dos marcas en un VPS, con HTTPS, backups de las dos bases y actualización
nocturna. Reemplaza a las dos PCs (Ford y Volkswagen) y a ngrok.

```
internet ──> Caddy :443 (HTTPS, Let's Encrypt)
               ├─ DOMINIO_FORD ──> web    ──> backend     ──> Postgres: calidad_ford · Redis DB 0
               └─ DOMINIO_VW   ──> web-vw ──> backend-vw  ──> Postgres: calidad_vw   · Redis DB 1
backup (03:00): dump de LAS DOS bases + copia fuera de OVH
```

Todo lo propio del servidor está en esta carpeta. Las PCs no se enteran: siguen
usando `docker-compose.prod.yml` solo, sin `docker-compose.ovh.yml`.

| Archivo | Para qué |
|---|---|
| `instalar-servidor.sh` | Prepara el VPS de cero (una vez) |
| `env.ovh.example` | Plantilla del `.env.prod` del servidor |
| `calidad.sh` | La única herramienta del día a día |
| `actualizar.sh` + `systemd/` | Actualización nocturna con vuelta atrás automática |
| `docker-compose.ovh.yml`, `Caddyfile` | Lo que el servidor agrega al compose de producción |
| `../../scripts/windows/Migrar-A-Servidor.bat` | En cada PC: congela, copia la base y arma las variables |
| `../../scripts/windows/Retirar-PC.bat` | En cada PC, al final: que no vuelva a levantar nada |

---

## 0. Conseguir antes

- [ ] **VPS-2** con Ubuntu 26.04, **Automated Backup Premium** (7 días) y **Snapshot**.
- [ ] **Una clave SSH propia**, cargada en el pedido de OVH (`ssh-keygen -t ed25519` en tu PC). Sin ella el instalador no puede desactivar el ingreso con contraseña.
- [ ] **Dos dominios** (ej. `calidad-ford.<empresa>` y `calidad-vw.<empresa>`) y acceso a su DNS.
- [ ] **El App Secret de cada app de Meta**: Meta for Developers → la app → Configuración → Básica → *Clave secreta de la app*.
- [ ] **Backblaze B2** (10 GB gratis): un bucket privado y una *application key* solo para ese bucket. Es la copia que sobrevive si pasa algo con OVH.
- [ ] **healthchecks.io** (gratis): tres chequeos — *backup* (período 1 día, gracia 2 h), *verificación* (7 días, gracia 6 h), *actualización* (1 día, gracia 2 h).
- [ ] **UptimeRobot** (gratis): dos monitores HTTP a `https://<dominio>/api/health`.

## 1. Instalar el servidor (una vez)

Desde tu PC, con la IP que manda OVH:

```bash
scp deploy/ovh/instalar-servidor.sh ubuntu@IP_DEL_SERVIDOR:
ssh ubuntu@IP_DEL_SERVIDOR
sudo bash instalar-servidor.sh
```

La primera vez **frena** y muestra una clave: GitHub → el repositorio →
Settings → Deploy keys → Add deploy key (**sin** *Allow write access*). Después
`sudo bash instalar-servidor.sh` de nuevo.

**DNS**: un registro **A** por dominio apuntando a la IP (TTL 300). No cargar
**AAAA** salvo que se configure IPv6 en el servidor: Let's Encrypt lo prueba y
falla.

## 2. Configurar y arrancar

```bash
sudo -u calidad cp /opt/calidad/deploy/ovh/env.ovh.example /opt/calidad/.env.prod
sudo -u calidad nano /opt/calidad/.env.prod      # completar
sudo chmod 600 /opt/calidad/.env.prod
```

- Los valores de cada marca salen de `variables-servidor-ford.env` y
  `variables-servidor-vw.env`, que arma `Migrar-A-Servidor.bat` en cada PC (paso 3).
  Para probar el servidor antes de la noche del cambio alcanza con dominios,
  `POSTGRES_PASSWORD` y cuatro claves nuevas (`openssl rand -hex 32`).
- ⚠️ Un valor vacío **no** puede tener un comentario al lado (`CLAVE=   # nota`):
  compose toma el comentario como valor. `calidad.sh verificar` lo detecta.
- Logos: `logo-ford.png` y `logo-volkswagen.png` en `/opt/calidad/backend/assets/`.

```bash
sudo -u calidad /opt/calidad/deploy/ovh/calidad.sh arrancar
sudo -u calidad /opt/calidad/deploy/ovh/calidad.sh verificar
```

## 3. La noche del cambio (una marca por vez)

Después de las 19 (ventana de envío cerrada) y **no un viernes**: si algo queda
a medias, Meta reintenta los mensajes entrantes hasta 36 h, y un fin de semana
es más largo que eso.

1. **Misma versión**: en la PC `http://localhost/api/health` y en el servidor
   `calidad.sh estado` tienen que mostrar el mismo commit. Si la PC está
   atrasada, `Actualizar-AHORA.bat` antes.
2. **En la PC** (sin administrador): `scripts\windows\Migrar-A-Servidor.bat`.
   Deja la PC detenida y arma la carpeta `Migracion\`. Anotar SHA256 y conteos.
3. **Pasar `Migracion\` al servidor** con WinSCP o `scp` a `/home/calidad/`.
   Nunca por WhatsApp ni por mail: tiene datos de clientes y claves.
4. **Completar `.env.prod`** con `variables-servidor-<marca>.env` más el
   `META_APP_SECRET` de esa marca. ⚠️ La clave de cifrado tiene que ser **exactamente** la de la PC.
5. **Restaurar** (compara SHA256 y conteos con los de la PC):
   ```bash
   sudo -u calidad /opt/calidad/deploy/ovh/calidad.sh arrancar
   sudo -u calidad /opt/calidad/deploy/ovh/calidad.sh restaurar ford /home/calidad/Migracion/calidad-ford-AAAAMMDD-HHMM.dump
   ```
6. **Meta** → WhatsApp → Configuración → Webhook: URL
   `https://<dominio de la marca>/api/webhooks/whatsapp`, **el mismo** verify token.
   Confirmar que la app está suscrita a la cuenta de WhatsApp:
   `GET https://graph.facebook.com/v20.0/<WABA_ID>/subscribed_apps` no puede
   devolver `{"data": []}` (si lo hace: `POST` a la misma URL). Sin eso Meta no
   entrega nada aunque el webhook esté verificado.
7. **Prueba de punta a punta**: entrar al sistema, mandarle un WhatsApp a un
   número propio, contestarlo, y ver la respuesta en Seguimiento.
8. `calidad.sh verificar` sin ningún **[MAL]**.
9. **En la PC**: `scripts\windows\Retirar-PC.bat`. Borrar
   `variables-servidor-*.env` de la PC y de `/home/calidad/Migracion/`.
10. Avisar a los usuarios la dirección nueva.

**Si algo falla antes del paso 9 — volver a la PC**: en la PC borrar
`SISTEMA-EN-SERVIDOR.txt` y abrir `Levantar-sistema.bat`; en Meta volver a la URL
de ngrok; en el servidor `calidad.sh compose stop backend` (o `backend-vw`), para
que las dos no manden WhatsApp a la vez.

## 4. Día a día

```bash
C=/opt/calidad/deploy/ovh/calidad.sh
sudo -u calidad $C estado            # qué corre y qué versión
sudo -u calidad $C logs backend-vw   # logs de un servicio
sudo -u calidad $C verificar         # chequeo completo
sudo -u calidad $C actualizar        # traer la última versión ya
sudo -u calidad $C backup-ahora      # backup de las dos bases ya
sudo -u calidad $C circuito          # diagnóstico del segundo contacto (VW)
journalctl -u calidad-actualizar     # qué pasó en la actualización nocturna
```

- **Actualización**: 01:30, sola. Si la versión nueva no responde en 10 minutos,
  vuelve a la anterior y avisa a healthchecks. La base **no** vuelve atrás.
- **Parches de Ubuntu**: automáticos. Si alguno pide reiniciar, a las 04:30.

## 5. Respaldos: tres capas

| Capa | Qué guarda | Dónde | Cuánto |
|---|---|---|---|
| Dump diario (03:00) | Las dos bases, por separado | Servidor + **Backblaze B2** | 14 días en el servidor |
| Automated Backup Premium | La máquina entera | OVH, mismo datacenter | 7 días |
| Snapshot | La máquina, a mano | OVH | 1 (el nuevo pisa al anterior) |

Los domingos a las 04:00 el contenedor de backup **restaura** el último dump de
cada base en una base temporal y cuenta los casos: la restauración se prueba sola
todas las semanas. Si falla o deja de correr, avisa healthchecks.

Antes de algo riesgoso (una migración grande, tocar el `.env`): **Snapshot** desde
el panel de OVH.

## 6. Pendientes conocidos

- `IPS_PERMITIDAS` solo sirve si las concesionarias tienen IP pública fija.
- El lector de Excel (xlsx 0.18.5) tiene vulnerabilidades conocidas
  (`docs/seguridad/auditoria-2026-08.md`, INJ-01). Queda fuera de esta mudanza.
- `deploy/servidor/` (INDEN) queda sin uso.
