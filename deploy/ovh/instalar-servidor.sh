#!/usr/bin/env bash
# ============================================================================
#  instalar-servidor.sh — prepara el VPS de OVHcloud desde cero (Ubuntu 26.04)
# ============================================================================
#  Se corre UNA vez, como root:   sudo bash instalar-servidor.sh
#  Es idempotente: se puede volver a correr, y hay que hacerlo después de cargar
#  la clave de despliegue en GitHub (el script frena y avisa).
#
#  Qué deja listo:
#    - hora de Argentina, swap, actualizaciones de seguridad automáticas
#    - Docker oficial, con rotación de logs (sin eso los logs llenan el disco)
#    - usuario "calidad" y el repositorio en /opt/calidad (clave de solo lectura)
#    - firewall (solo 22, 80 y 443), fail2ban, SSH solo con clave
#    - la actualización nocturna programada
#  Lo que NO hace: el .env.prod, los logos, el DNS y la restauración de las bases.
#  Eso está en deploy/ovh/README.md.
# ============================================================================
set -euo pipefail

REPO_SSH="git@github.com:nh0875/calidad-ford-Goldstein.git"
DESTINO="/opt/calidad"
USUARIO="calidad"

paso() { printf '\n\033[36m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m[OK]\033[0m %s\n' "$*"; }
ojo()  { printf '   \033[33m[!]\033[0m  %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Correlo como root:  sudo bash $0"; exit 1; }
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || { echo "Este script es para Ubuntu (encontré: ${PRETTY_NAME:-?})."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

paso "Hora de Argentina"
timedatectl set-timezone America/Argentina/Buenos_Aires
ok "$(timedatectl show -p Timezone --value)"

paso "Paquetes base y actualizaciones pendientes"
apt-get update -q
apt-get -y -q upgrade
apt-get -y -q install ca-certificates curl git jq ufw fail2ban unattended-upgrades
ok "listo"

paso "Swap (4 GB)"
# Sin swap, un pico de memoria (una importación grande mientras compila) no hace
# que el servidor vaya más lento: el kernel mata un contenedor.
if [ -z "$(swapon --show)" ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-calidad.conf && sysctl -q --system
ok "$(swapon --show --noheadings | awk '{print $1, $3}')"

paso "Actualizaciones de seguridad automáticas"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
# Reinicia solo si un parche lo pide, a las 04:30: después del backup (03:00) y
# lejos de la ventana de envío de WhatsApp (09 a 19). Los contenedores vuelven solos.
cat > /etc/apt/apt.conf.d/52calidad-unattended <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF
ok "parches diarios, reinicio si hace falta a las 04:30"

paso "Docker (repositorio oficial)"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  codename="${VERSION_CODENAME}"
  # Si Docker todavía no publicó esta versión de Ubuntu, se usa la LTS anterior.
  curl -fsI "https://download.docker.com/linux/ubuntu/dists/${codename}/Release" >/dev/null 2>&1 || { ojo "Docker no tiene '${codename}': uso noble"; codename=noble; }
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if [ ! -f /etc/docker/daemon.json ]; then
  # Rotación de logs: por defecto Docker los guarda enteros para siempre.
  # live-restore: los contenedores siguen andando si se reinicia el servicio de Docker.
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true
}
EOF
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null
ok "$(docker --version) · $(docker compose version --short)"

paso "Usuario '$USUARIO' y repositorio"
id "$USUARIO" >/dev/null 2>&1 || useradd -m -s /bin/bash "$USUARIO"
usermod -aG docker "$USUARIO"
CASA="$(getent passwd "$USUARIO" | cut -d: -f6)"
CLAVE="$CASA/.ssh/github_calidad"
if [ ! -f "$CLAVE" ]; then
  sudo -u "$USUARIO" mkdir -p "$CASA/.ssh" && chmod 700 "$CASA/.ssh"
  sudo -u "$USUARIO" ssh-keygen -q -t ed25519 -N "" -C "servidor-ovh-calidad" -f "$CLAVE"
  sudo -u "$USUARIO" tee "$CASA/.ssh/config" >/dev/null <<EOF
Host github.com
  IdentityFile $CLAVE
  IdentitiesOnly yes
EOF
  sudo -u "$USUARIO" sh -c "ssh-keyscan -t ed25519 github.com >> '$CASA/.ssh/known_hosts' 2>/dev/null"
fi
if [ ! -d "$DESTINO/.git" ]; then
  mkdir -p "$DESTINO" && chown "$USUARIO:$USUARIO" "$DESTINO"
  if ! sudo -u "$USUARIO" git clone -q "$REPO_SSH" "$DESTINO" 2>/dev/null; then
    echo
    ojo "GitHub todavía no conoce a este servidor. Cargá esta clave (SOLO LECTURA):"
    echo "     GitHub -> el repositorio -> Settings -> Deploy keys -> Add deploy key"
    echo "     (NO tildar 'Allow write access')"
    echo
    cat "$CLAVE.pub"
    echo
    echo "   Y volvé a correr:  sudo bash $0"
    exit 2
  fi
fi
ok "repositorio en $DESTINO ($(sudo -u "$USUARIO" git -C "$DESTINO" rev-parse --short HEAD))"

paso "Firewall"
# Docker publica sus puertos por delante de UFW; por eso las pantallas del
# sistema escuchan solo en 127.0.0.1 (ver docker-compose.ovh.yml) y lo único
# público es Caddy en 80/443.
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ok "abiertos: 22, 80, 443"

paso "SSH y fail2ban"
cat > /etc/fail2ban/jail.d/calidad.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban >/dev/null && systemctl restart fail2ban
ADMIN="${SUDO_USER:-root}"
LLAVES="$(getent passwd "$ADMIN" | cut -d: -f6)/.ssh/authorized_keys"
if [ -s "$LLAVES" ]; then
  # "00-" para que se lea PRIMERO: sshd se queda con el primer valor que
  # encuentra, y la imagen de la nube trae un 50-cloud-init.conf que habilita
  # la contraseña. Con otro nombre, esa línea ganaría en silencio.
  cat > /etc/ssh/sshd_config.d/00-calidad.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
  sshd -t && systemctl try-reload-or-restart ssh
  ok "SSH solo con clave (la de $ADMIN)"
else
  ojo "$ADMIN no tiene clave SSH cargada: NO se desactiva la contraseña (te dejaría afuera)."
  ojo "Cargá tu clave pública en $LLAVES y volvé a correr el script."
fi

paso "Actualización nocturna (01:30)"
chmod +x "$DESTINO"/deploy/ovh/*.sh
install -m 644 "$DESTINO/deploy/ovh/systemd/calidad-actualizar.service" /etc/systemd/system/
install -m 644 "$DESTINO/deploy/ovh/systemd/calidad-actualizar.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now calidad-actualizar.timer >/dev/null
ok "$(systemctl list-timers calidad-actualizar.timer --no-legend | awk '{print "próxima: " $1, $2, $3}')"

paso "Falta (ver deploy/ovh/README.md)"
cat <<EOF
   1. Logos:   copiar logo-ford.png y logo-volkswagen.png a $DESTINO/backend/assets/
   2. Config:  sudo -u $USUARIO cp $DESTINO/deploy/ovh/env.ovh.example $DESTINO/.env.prod
               completar, y:  sudo chmod 600 $DESTINO/.env.prod
   3. DNS:     los dos dominios apuntando a $(curl -fsS -4 -m 5 https://ifconfig.me 2>/dev/null || echo "la IP del servidor")
   4. Arrancar:  sudo -u $USUARIO $DESTINO/deploy/ovh/calidad.sh arrancar
   5. Restaurar las bases de las PCs y:  sudo -u $USUARIO $DESTINO/deploy/ovh/calidad.sh verificar
EOF
