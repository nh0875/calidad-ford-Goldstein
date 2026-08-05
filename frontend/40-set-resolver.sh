#!/bin/sh
# Reemplaza __RESOLVER__ en la config de nginx por el DNS real del contenedor.
# En Docker el DNS embebido es 127.0.0.11; en Podman (netavark/aardvark) suele ser
# otra IP. Se lee de /etc/resolv.conf. Lo corre el propio entrypoint del nginx
# oficial (ejecuta todo lo que esté en /docker-entrypoint.d/*.sh antes de arrancar).
set -e
RESOLVER=$(awk '/^nameserver/ {print $2; exit}' /etc/resolv.conf 2>/dev/null)
[ -z "$RESOLVER" ] && RESOLVER="127.0.0.11"
sed -i "s|__RESOLVER__|${RESOLVER}|g" /etc/nginx/conf.d/default.conf
echo "[40-set-resolver] resolver de nginx = ${RESOLVER}"
