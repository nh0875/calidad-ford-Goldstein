#!/usr/bin/env bash
# ============================================================================
#  calidad.sh — la única herramienta que hace falta en el servidor
# ============================================================================
#  Arma SIEMPRE el mismo comando de docker compose (proyecto, los dos archivos,
#  el .env y el perfil de VW). Escribirlo a mano es la forma más fácil de
#  equivocarse: olvidarse del overlay levanta el sistema sin HTTPS, olvidarse del
#  perfil deja a Volkswagen apagado, y otro nombre de proyecto levanta un stack
#  NUEVO con las bases vacías.
#
#  Uso:  ./deploy/ovh/calidad.sh <comando>
#    arrancar                       construye y levanta todo, y espera a que responda
#    parar                          detiene los contenedores (no borra nada)
#    estado                         qué está corriendo y qué versión
#    logs [servicio]                sigue los logs (backend, backend-vw, caddy, ...)
#    actualizar                     trae la última versión (lo mismo que hace el timer)
#    restaurar <ford|vw> <archivo>  carga en el servidor el dump de una PC
#    verificar                      revisa TODO lo que tiene que estar bien
#    backup-ahora                   corre el backup de las dos bases en este momento
#    circuito                       diagnóstico del segundo contacto (Volkswagen)
#    compose <args...>              docker compose con todo ya puesto
# ============================================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"
ENV_FILE="$RAIZ/.env.prod"

ok()    { printf '  \033[32m[OK]\033[0m    %s\n' "$*"; }
aviso() { printf '  \033[33m[AVISO]\033[0m %s\n' "$*"; AVISOS=$((AVISOS + 1)); }
mal()   { printf '  \033[31m[MAL]\033[0m   %s\n' "$*"; ERRORES=$((ERRORES + 1)); }
morir() { printf '\n  \033[31m%s\033[0m\n\n' "$*" >&2; exit 1; }
AVISOS=0; ERRORES=0

dc() {
  docker compose -p calidad \
    -f docker-compose.prod.yml -f deploy/ovh/docker-compose.ovh.yml \
    --env-file "$ENV_FILE" --profile vw "$@"
}

# Lee una variable del .env.prod IGUAL que compose, trampa incluida: compose solo
# recorta el comentario de al lado cuando ANTES hay un valor ("CLAVE=abc # nota").
# Si la línea es "CLAVE=   # nota", el valor que le pasa al sistema es "# nota".
# Leerlo distinto acá haría que verificar diga "vacía" mientras el backend recibe
# el comentario como clave.
leer_env() {
  local v
  v="$(grep -E "^[[:space:]]*$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-)" || true
  v="$(printf '%s' "$v" | sed -e 's/^[[:space:]]*//')"
  case "$v" in
    \#*) ;;
    *) v="$(printf '%s' "$v" | sed -e 's/[[:space:]]\{1,\}#.*$//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")" ;;
  esac
  printf '%s' "$v"
}

# "MARCA VERSION ESTADO" de un backend, por el puerto local de su pantalla.
salud() {
  curl -fsS -m 5 "http://127.0.0.1:$1/api/health" 2>/dev/null |
    jq -r '"\(.marca) \(.version) \(.status)"' 2>/dev/null || true
}

commit_actual() { git rev-parse --short HEAD; }

# Espera a que LAS DOS marcas respondan sanas con la versión pedida.
esperar_salud() {
  local quiero="$1" limite=$((SECONDS + 600)) f v
  while [ $SECONDS -lt $limite ]; do
    f="$(salud 8081)"; v="$(salud 8082)"
    if [ "$f" = "FORD $quiero ok" ] && [ "$v" = "VOLKSWAGEN $quiero ok" ]; then return 0; fi
    sleep 10
  done
  echo "  Ford responde: ${f:-nada}   ·   Volkswagen responde: ${v:-nada}" >&2
  return 1
}

requerir_env() {
  [ -f "$ENV_FILE" ] || morir "No existe $ENV_FILE. Copiá deploy/ovh/env.ovh.example ahí y completalo."
}

cmd_arrancar() {
  requerir_env
  local c; c="$(commit_actual)"
  echo "  Construyendo y levantando la versión $c (la primera vez tarda varios minutos)..."
  GIT_COMMIT="$c" dc up -d --build
  echo "  Esperando a que las dos marcas respondan (aplican migraciones al arrancar)..."
  esperar_salud "$c" || morir "No respondieron a tiempo. Mirá: ./deploy/ovh/calidad.sh logs backend"
  ok "Ford y Volkswagen andando con la versión $c."
}

cmd_estado() {
  requerir_env
  dc ps
  echo
  echo "  Ford       : $(salud 8081 || true)"
  echo "  Volkswagen : $(salud 8082 || true)"
  echo "  Código     : $(commit_actual)  $(git log -1 --pretty=%s)"
}

cmd_restaurar() {
  requerir_env
  local marca="${1:-}" archivo="${2:-}" forzar="${3:-}" db svc puerto user casos
  case "$marca" in
    ford) db="$(leer_env POSTGRES_DB)";    db="${db:-calidad_ford}"; svc=backend;    puerto=8081 ;;
    vw)   db="$(leer_env POSTGRES_DB_VW)"; db="${db:-calidad_vw}";   svc=backend-vw; puerto=8082 ;;
    *) morir "Uso: calidad.sh restaurar <ford|vw> <archivo.dump> [--forzar]" ;;
  esac
  [ -f "$archivo" ] || morir "No encuentro el archivo $archivo"
  user="$(leer_env POSTGRES_USER)"; user="${user:-calidad}"

  echo "  Restaurando $archivo en la base $db"
  echo "  SHA256: $(sha256sum "$archivo" | cut -d' ' -f1)  (tiene que coincidir con el que mostró la PC)"
  dc up -d postgres
  for _ in $(seq 1 30); do dc exec -T postgres pg_isready -U "$user" >/dev/null 2>&1 && break; sleep 2; done
  dc exec -T postgres sh -c 'createdb -U "$1" "$2" 2>/dev/null || true' sh "$user" "$db"

  # El backend de ESA marca se detiene: que nadie escriba ni migre durante la carga.
  dc stop "$svc" >/dev/null 2>&1 || true

  casos="$(dc exec -T postgres psql -U "$user" -d "$db" -tAc 'SELECT COUNT(*) FROM "Caso"' 2>/dev/null | tr -d '[:space:]' || true)"
  if [ "${casos:-0}" -gt 0 ] 2>/dev/null && [ "$forzar" != "--forzar" ]; then
    morir "La base $db YA tiene $casos casos. Si de verdad querés pisarla: calidad.sh restaurar $marca $archivo --forzar"
  fi

  dc cp "$archivo" postgres:/tmp/restaurar.dump
  if dc exec -T postgres pg_restore -U "$user" -d "$db" --clean --if-exists --no-owner --no-acl /tmp/restaurar.dump; then
    ok "pg_restore terminó sin errores."
  else
    aviso "pg_restore terminó con avisos. Si los conteos de abajo dan bien, suele ser inofensivo."
  fi
  dc exec -T postgres rm -f /tmp/restaurar.dump

  for t in Caso RQR Usuario WhatsappMessage; do
    printf '    %-16s %s\n' "$t" "$(dc exec -T postgres psql -U "$user" -d "$db" -tAc "SELECT COUNT(*) FROM \"$t\"" 2>/dev/null | tr -d '[:space:]')"
  done

  local c; c="$(commit_actual)"
  echo "  Levantando $svc (aplica las migraciones que le falten a la base de la PC)..."
  GIT_COMMIT="$c" dc up -d "$svc"
  local limite=$((SECONDS + 300))
  until [ "$(salud "$puerto" | awk '{print $3}')" = "ok" ] || [ $SECONDS -ge $limite ]; do sleep 5; done
  [ "$(salud "$puerto" | awk '{print $3}')" = "ok" ] || morir "El backend no quedó sano. Mirá: calidad.sh logs $svc"
  ok "Base de $marca restaurada y backend andando."
  echo "  Probá entrar y mandar un WhatsApp de prueba. Si falla con un error de credenciales,"
  echo "  la clave de cifrado de esta marca en .env.prod no es la de su PC."
}

cmd_verificar() {
  requerir_env
  echo; echo "  Configuración"
  local perm; perm="$(stat -c %a "$ENV_FILE")"
  [ "$perm" = "600" ] && ok ".env.prod solo lo lee su dueño" || aviso ".env.prod tiene permisos $perm: correr  chmod 600 .env.prod"
  # "CLAVE=   # nota": compose le pasa "# nota" al sistema como si fuera la clave.
  local trampa
  trampa="$(grep -E '^[A-Za-z_0-9]+=[[:space:]]+#' "$ENV_FILE" | cut -d= -f1 | tr '\n' ' ' || true)"
  [ -z "$trampa" ] && ok "ninguna variable tiene un comentario en lugar de valor" \
    || mal "valor vacío con un comentario al lado (compose toma el comentario COMO VALOR): ${trampa}— pasá el comentario a la línea de arriba"
  local k
  for k in DOMINIO_FORD DOMINIO_VW ACME_EMAIL POSTGRES_PASSWORD CONFIG_ENCRYPTION_KEY VW_CONFIG_ENCRYPTION_KEY JWT_SECRET VW_JWT_SECRET; do
    [ -n "$(leer_env "$k")" ] && ok "$k cargada" || mal "$k está vacía"
  done
  [ "$(leer_env MARCA)" = "VOLKSWAGEN" ] && mal "MARCA=VOLKSWAGEN: el backend de FORD correría como Volkswagen"
  [ "$(leer_env JWT_SECRET)" != "$(leer_env VW_JWT_SECRET)" ] || mal "JWT_SECRET y VW_JWT_SECRET son iguales: una sesión valdría en las dos marcas"
  for k in META_APP_SECRET VW_META_APP_SECRET; do
    [ -n "$(leer_env "$k")" ] && ok "$k cargada" || aviso "$k vacía: el webhook acepta notificaciones sin firma de Meta"
  done
  [ -n "$(leer_env BACKUP_S3_BUCKET)" ] && ok "copia de backups fuera de OVH configurada" || aviso "sin BACKUP_S3_*: los backups quedan solo en este servidor"
  for k in BACKUP_HEALTHCHECK_URL VERIFY_HEALTHCHECK_URL ACTUALIZACION_HEALTHCHECK_URL; do
    [ -n "$(leer_env "$k")" ] || aviso "$k vacía: si eso falla o deja de correr, nadie se entera"
  done
  for k in ford volkswagen; do
    [ -f "backend/assets/logo-$k.png" ] && ok "logo-$k.png presente" || aviso "falta backend/assets/logo-$k.png: el Word del RQR sale sin logo"
  done

  echo; echo "  Contenedores y versión"
  local c; c="$(commit_actual)"
  local s
  for s in postgres redis backend backend-vw web web-vw caddy backup; do
    [ -n "$(dc ps --status running -q "$s" 2>/dev/null)" ] && ok "$s corriendo" || mal "$s NO está corriendo"
  done
  [ "$(salud 8081)" = "FORD $c ok" ] && ok "Ford sano, versión $c" || mal "Ford responde: '$(salud 8081)' (se esperaba FORD $c ok)"
  [ "$(salud 8082)" = "VOLKSWAGEN $c ok" ] && ok "Volkswagen sano, versión $c" || mal "Volkswagen responde: '$(salud 8082)' (se esperaba VOLKSWAGEN $c ok)"
  dc exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    && ok "Caddyfile válido" || mal "Caddyfile inválido: calidad.sh compose exec caddy caddy validate --config /etc/caddy/Caddyfile"
  if ss -ltn 2>/dev/null | grep -E ':(8081|8082)\b' | grep -vq '127.0.0.1'; then
    mal "las pantallas escuchan fuera de 127.0.0.1: quedan expuestas sin HTTPS"
  else
    ok "las pantallas solo escuchan en 127.0.0.1"
  fi

  echo; echo "  Desde internet (DNS + HTTPS + webhook)"
  local marca dom token secreto codigo
  for marca in FORD VW; do
    if [ "$marca" = FORD ]; then dom="$(leer_env DOMINIO_FORD)"; token="$(leer_env META_WEBHOOK_VERIFY_TOKEN)"; secreto="$(leer_env META_APP_SECRET)"
    else dom="$(leer_env DOMINIO_VW)"; token="$(leer_env VW_META_WEBHOOK_VERIFY_TOKEN)"; secreto="$(leer_env VW_META_APP_SECRET)"; fi
    [ -n "$dom" ] || continue
    curl -fsS -m 10 "https://$dom/api/health" >/dev/null 2>&1 \
      && ok "https://$dom responde con certificado válido" || mal "https://$dom no responde (¿DNS apuntando acá? ¿puertos 80/443?)"
    if [ -n "$token" ]; then
      [ "$(curl -fsS -m 10 "https://$dom/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$token&hub.challenge=calidad123" 2>/dev/null)" = "calidad123" ] \
        && ok "$dom: el webhook acepta el verify token del .env" \
        || mal "$dom: el webhook rechaza el verify token del .env (la base puede tener OTRO guardado en Configuración: gana el de la base)"
    fi
    codigo="$(curl -s -o /dev/null -m 10 -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "https://$dom/api/webhooks/whatsapp" || true)"
    if [ -n "$secreto" ]; then
      [ "$codigo" = "401" ] && ok "$dom: un POST sin firma de Meta se rechaza" || mal "$dom: un POST sin firma devolvió $codigo (se esperaba 401)"
    fi
  done

  echo; echo "  Respaldos"
  local estado
  estado="$(dc exec -T backend cat /var/backup-status/status.json 2>/dev/null || true)"
  if [ -z "$estado" ]; then
    aviso "todavía no corrió ningún backup (corre a las $(leer_env BACKUP_HOUR):00; para probar ya: calidad.sh backup-ahora)"
  else
    echo "$estado" | jq -r '.ultimoBackup | "    último backup : \(.fecha)  ok=\(.ok)  fuera de OVH=\(.subidoAOffsite)\n    \(.mensaje)"' 2>/dev/null || true
    [ "$(echo "$estado" | jq -r '.ultimoBackup.ok' 2>/dev/null)" = "true" ] && ok "el último backup salió bien" || mal "el último backup FALLÓ"
  fi

  echo; echo "  Servidor"
  local libre; libre="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
  [ "$libre" -lt 80 ] && ok "disco al ${libre}%" || aviso "disco al ${libre}%: limpiar con  docker system prune"
  [ -n "$(swapon --show 2>/dev/null)" ] && ok "swap activa" || aviso "sin swap: un pico de memoria mata un contenedor en vez de ir más lento"
  systemctl is-active --quiet calidad-actualizar.timer && ok "actualización nocturna programada" || mal "el timer calidad-actualizar no está activo"
  ufw status 2>/dev/null | grep -q "Status: active" && ok "firewall activo" || aviso "no pude confirmar el firewall (correr como root: sudo ufw status)"
  [ "$(timedatectl show -p Timezone --value 2>/dev/null)" = "America/Argentina/Buenos_Aires" ] && ok "hora del servidor en Argentina" || aviso "la zona horaria del servidor no es Argentina"

  echo
  if [ $ERRORES -gt 0 ]; then echo "  $ERRORES problema(s) y $AVISOS aviso(s)."; exit 1; fi
  echo "  Todo bien ($AVISOS aviso(s))."
}

comando="${1:-}"; shift || true
case "$comando" in
  arrancar)     cmd_arrancar ;;
  parar)        requerir_env; dc stop ;;
  estado)       cmd_estado ;;
  logs)         requerir_env; dc logs --tail 200 -f "$@" ;;
  actualizar)   exec "$RAIZ/deploy/ovh/actualizar.sh" "$@" ;;
  restaurar)    cmd_restaurar "$@" ;;
  verificar)    cmd_verificar ;;
  backup-ahora) requerir_env; dc exec -T backup /opt/backup/backup.sh ;;
  circuito)     requerir_env; dc exec -T backend-vw node dist/scripts/diagnostico-circuito.js ;;
  compose)      requerir_env; dc "$@" ;;
  *) sed -n '3,22p' "$0"; exit 1 ;;
esac
