#!/bin/sh
# Ajusta el resolver de DNS de nginx al del contenedor. En Docker es 127.0.0.11
# (ya es el default en la config); en Podman (netavark/aardvark) suele ser otra
# IP, que se lee de /etc/resolv.conf. Lo corre el entrypoint del nginx oficial
# (ejecuta /docker-entrypoint.d/*.sh antes de arrancar). Si algo falla, la config
# queda con el default 127.0.0.11 y nginx igual arranca (el frontend carga).
set -e
RESOLVER=$(awk '/^nameserver/ {print $2; exit}' /etc/resolv.conf 2>/dev/null)
if [ -n "$RESOLVER" ]; then
  sed -i "s|resolver [0-9.]*|resolver ${RESOLVER}|" /etc/nginx/conf.d/default.conf
fi
echo "[40-set-resolver] resolver de nginx = ${RESOLVER:-127.0.0.11 (default)}"
