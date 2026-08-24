# Volkswagen en su propia PC

Plan para separar Volkswagen a una computadora distinta de la de Ford.

**Estado: preparado, no ejecutado.** El código ya soporta las dos formas de
desplegar; falta hacer la instalación en la PC nueva.

---

## Qué cambia respecto del plan anterior

Hasta ahora las dos marcas iban a compartir una PC: Ford como stack principal y
Volkswagen agregada con el perfil `vw` (otra base dentro del mismo Postgres, otro
índice de Redis, y el webhook de las dos entrando por el mismo túnel de ngrok
separado por la ruta `/api/vw/webhooks/`).

Con una PC por marca **nada de eso hace falta**. En la PC de Volkswagen corre el
sistema de siempre, configurado como Volkswagen:

|                       | Una PC (plan viejo)                    | Una PC por marca (plan nuevo)     |
| --------------------- | -------------------------------------- | --------------------------------- |
| Servicios de VW       | `backend-vw`, `web-vw`, `init-db-vw`   | los de siempre: `backend`, `web`  |
| Perfil de compose     | `COMPOSE_PROFILES=vw`                  | ninguno                           |
| Base de datos         | dos bases en un Postgres               | un Postgres por PC                |
| Redis                 | un Redis, índices `/0` y `/1`          | un Redis por PC                   |
| Variables de VW       | con prefijo `VW_`                      | **sin prefijo**, las de siempre   |
| Webhook               | `.../api/vw/webhooks/whatsapp`         | `.../api/webhooks/whatsapp`       |
| Túnel de ngrok        | uno compartido                         | **uno por PC**                    |
| Puerto                | Ford 80, VW 8080                       | 80 en cada una                    |

Es más simple y más robusto: una marca no puede llevarse puesta a la otra, ni por
memoria, ni por una actualización, ni por un error de configuración.

El perfil `vw` **se deja en el código**. No molesta y sirve para volver a juntar
las dos marcas en una PC si alguna vez hace falta (por ejemplo, mientras se
repara una de las dos máquinas).

---

## Lo que ya está hecho

- El stack principal **ya no está atado a Ford**: la marca la fija `MARCA` en el
  `.env.prod`, con `FORD` por defecto. La PC de Ford no cambia en nada aunque no
  defina la variable.
- `iniciar-sistema.bat` y `vigilante.ps1` **leen el dominio de ngrok del
  `.env.prod`** en vez de tenerlo escrito adentro. Sin esto, en la PC de VW el
  vigilante buscaría el túnel de Ford, no lo encontraría nunca, y estaría matando
  y relanzando ngrok cada 5 minutos para siempre.
- Se probó levantando el stack completo con `MARCA=VOLKSWAGEN` en un proyecto
  aparte: arrancan 5 servicios (ninguno `-vw`), el sistema responde como
  Volkswagen (estrellas, catálogo de áreas de VW, Encuestas de fábrica,
  Fidelización en 404) y el webhook contesta en `/api/webhooks/whatsapp` con el
  token de VW y rechaza el de Ford.

---

## Lo que hay que conseguir ANTES de la instalación

1. **La PC.** Mínimo 8 GB de RAM. La de Ford tiene 5,8 GB y ese es exactamente el
   motivo por el que Docker se cae seguido y hay que tener un vigilante que lo
   levante. Con 8 GB o más, ese problema desaparece.
2. **Una segunda cuenta de ngrok**, con su propio dominio estático reservado. El
   plan gratuito da **un solo dominio por cuenta**, así que el de Ford no se puede
   compartir. Es gratis: se crea con otro correo (por ejemplo el de Calidad de VW)
   y se reserva el dominio desde el panel.
3. **El `PHONE_NUMBER_ID` de VW**, del panel de Meta → WhatsApp → API Setup. Es el
   único dato que sigue faltando.
4. **Una carpeta propia de OneDrive/SharePoint** para los respaldos de VW, para
   que no se mezclen con los de Ford.

---

## Paso a paso el día de la instalación

### 1. Preparar la PC

Instalar Docker Desktop y ngrok, e iniciar sesión en ngrok con la cuenta NUEVA
(no la de Ford). Después clonar el repositorio.

### 2. Armar el `.env.prod` de esa PC

Es igual al de Ford pero con los datos de VW, **sin ningún prefijo `VW_`**. Lo
importante:

```ini
# Esta es la línea que define todo lo demás.
MARCA=VOLKSWAGEN

POSTGRES_USER=calidad
POSTGRES_PASSWORD=<una contraseña fuerte, PROPIA de esta PC>
POSTGRES_DB=calidad_vw

HTTP_PORT=80
FRONTEND_URL=http://localhost

# Secretos PROPIOS de esta PC (no copiar los de Ford):
#   generar con:  openssl rand -hex 32
JWT_SECRET=<32 bytes al azar>
CONFIG_ENCRYPTION_KEY=<32 bytes al azar>

ADMIN_EMAIL=calidadvolkswagengoldstein@gmail.com
ADMIN_PASSWORD_INICIAL=<cambiar apenas se entre>

# El túnel de ESTA PC (la cuenta nueva de ngrok).
NGROK_DOMAIN=<el dominio reservado para VW>

# WhatsApp de VW, en las variables de siempre (sin VW_).
META_WHATSAPP_TOKEN=<el token de System User de VW>
META_PHONE_NUMBER_ID=<del panel de Meta>
META_WEBHOOK_VERIFY_TOKEN=<inventar uno, distinto del de Ford>
META_TEMPLATE_NAME=contacto_posventa
META_TEMPLATE_LANG=es_AR
META_TEMPLATE_VENTA_NAME=contacto_venta

# LA IA QUE CLASIFICA. Sin estas dos líneas el sistema levanta igual, pero NO
# clasifica NADA: en el arranque avisa "sin API key (fallará al llamar)" y cada
# respuesta de cliente queda sin analizar. Es la misma key que usa Ford.
AI_PROVIDER=gemini
GEMINI_API_KEY=<la misma key de Gemini que usa Ford>

# Correo saliente: los avisos a los vendedores de las encuestas de fábrica.
MAIL_USUARIO=calidadvolkswagengoldstein@gmail.com
MAIL_PASSWORD=<contraseña de aplicación de Google>
```

> **Lo más fácil de olvidar es `GEMINI_API_KEY`.** Se probó levantando una PC
> limpia siguiendo este instructivo al pie de la letra y el sistema arrancó
> perfecto — con la clasificación muerta. Después de levantar, mirá el arranque:
>
> ```
> docker compose -f docker-compose.prod.yml --env-file .env.prod logs backend | Select-String "\[IA\]"
> ```
>
> Tiene que decir **`IA REAL vía gemini`**. Si dice `sin API key`, falta esa línea.

**No poner `COMPOSE_PROFILES=vw`.** Esa línea es para cuando las dos marcas
comparten una PC; acá sobra y levantaría contenedores de más.

### 3. Levantar

```
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Las migraciones se aplican solas al arrancar. La primera vez tarda bastante
porque compila las imágenes.

Verificar que diga Volkswagen:

```
curl http://localhost/api/marca
```

Tiene que responder `"codigo":"VOLKSWAGEN"` y `"escala":"ESTRELLAS"`.

### 4. Configurar el webhook en Meta

| Campo        | Valor                                              |
| ------------ | -------------------------------------------------- |
| Callback URL | `https://<dominio-de-vw>/api/webhooks/whatsapp`     |
| Verify token | el `META_WEBHOOK_VERIFY_TOKEN` de esta PC           |
| Suscribir    | el campo **messages**                              |

**Ojo:** ahora la URL va **sin** `/vw`. Ese prefijo era para cuando las dos
marcas compartían un túnel.

### 5. Dejarlo andando solo

Registrar en el Programador de tareas de Windows, igual que en la PC de Ford:

- `iniciar-sistema.bat` al iniciar el sistema.
- `vigilante.ps1` cada 5 minutos.
- Una tarea propia para ngrok (no la lanza el `.bat` como proceso hijo, porque
  Windows lo mata al terminar la tarea).
- El respaldo diario (`Instalar-Respaldo-Diario.ps1`), apuntando a la carpeta de
  OneDrive de VW.

Los dos primeros ya leen el `.env.prod` de la máquina donde corren, así que **no
hay que editarlos**.

### 6. Cargar los datos

- Los correos de los vendedores, en la pestaña **Encuestas de fábrica**.
- El Excel de encuestas pendientes de fábrica.
- Los usuarios de Calidad de VW.

---

## Qué pasa con la PC de Ford

**Nada.** No hay que tocarla. No define `MARCA`, así que sigue siendo Ford; no
define `COMPOSE_PROFILES`, así que nunca levantó los contenedores de VW.

Si en algún momento se le llegó a poner `COMPOSE_PROFILES=vw`, hay que sacarlo
cuando VW pase a su PC, para que no queden dos VW corriendo.

---

## Datos: no hay nada que migrar

Volkswagen nunca llegó a estar en producción en la PC de Ford (su `.env.prod` no
tiene ninguna variable de VW), así que la instalación arranca de cero.

Si por algo hubiera datos que rescatar, se pasan con un dump:

```
# en la PC vieja
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_dump -U calidad -Fc calidad_vw > calidad_vw.dump

# en la PC nueva, con el stack ya levantado
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_restore -U calidad -d calidad_vw --clean --if-exists < calidad_vw.dump
```

---

## Para revisar cuando esté instalado

- [ ] `http://localhost/api/marca` dice `VOLKSWAGEN` y `ESTRELLAS`.
- [ ] Se entra con el usuario admin y la pantalla se ve con los colores de VW.
- [ ] Está la pestaña **Encuestas de fábrica** y NO está **Fidelización**.
- [ ] El RQR muestra Área principal, Subárea y el casillero de cliente anónimo.
- [ ] Meta verifica el webhook (botón "Verificar y guardar").
- [ ] Llega un WhatsApp de prueba y aparece en Seguimiento.
- [ ] Se apaga la PC, se prende, y el sistema vuelve solo (tarea de arranque).
- [ ] El respaldo diario deja el archivo en la carpeta de OneDrive de VW.
- [ ] El `vigilante.log` no muestra reinicios de ngrok en bucle (sería que el
      `NGROK_DOMAIN` del `.env.prod` no coincide con el dominio real).
