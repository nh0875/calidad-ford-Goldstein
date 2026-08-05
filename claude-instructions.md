# Instrucciones de Arquitectura y Despliegue

## Contexto de la Infraestructura (LÉEME PRIMERO)
Estás asistiendo al desarrollador (el usuario) en la creación y despliegue de aplicaciones. Eres responsable de que el código generado sea 100% compatible con nuestra topología de servidores.

**Topología Actual:**
Contamos con **dos Máquinas Virtuales (VMs) independientes** corriendo Ubuntu, Podman (en modo Rootless) y Nginx Proxy Manager (NPM).
1.  **Entorno DEV (Staging):**
    *   Certificado Comodín: `*.dev.mariogoldsteinsa.com.ar`
    *   Gestor Proxy: `nginx.dev.mariogoldsteinsa.com.ar`
    *   Gestión Docker: Administrado a través del Agente de Portainer.
2.  **Entorno PROD (Producción):**
    *   Certificado Comodín: `*.apps.mariogoldsteinsa.com.ar`
    *   Gestor Proxy: `nginx.apps.mariogoldsteinsa.com.ar`
    *   Gestión Docker: Aquí reside Portainer Business (`portainer.apps.mariogoldsteinsa.com.ar`) gestionando el Podman local y conectándose al Agente en Dev.

---

## REGLAS ESTRICTAS (Hard Rules)

### 1. Limitaciones por Podman Rootless
*   **Prohibido Compilar en el Host:** NO uses `build:`, `context:` en el `docker-compose.yml`. Todas las imágenes deben ser compiladas por GitHub Actions y descargadas desde GitHub Container Registry (GHCR).
*   **Prohibido Bind Mounts para estáticos:** Debido a permisos Rootless (`mkdir /data: permission denied`), NO uses bind mounts (`./ruta:/ruta`) para inyectar configuraciones o código. Usa un `Dockerfile` con la instrucción `COPY`. Solo se permiten Volúmenes Nombrados para persistencia de Bases de Datos.

### 2. Nomenclatura e Imágenes
*   Las rutas de imágenes en el `docker-compose.yml` deben estar **100% en minúsculas**.

### 3. Redes, Puertos y Firewall
*   **Cero cambios en Firewall:** Todo el tráfico entrante pasa por Nginx Proxy Manager. Nunca indiques abrir puertos en el firewall de la VM (iptables/ufw).
*   **Puertos Expuestos:** Los puertos 80 y 443 del servidor ya están ocupados por NPM. Expón puertos altos en el host (ej. `8080:80`, `3000:3000`) para que NPM pueda enrutar el tráfico hacia ellos. Dado que Dev y Prod son VMs distintas, puedes usar el mismo puerto expuesto en ambas ramas sin conflicto.
*   **Variables de Entorno:** Nunca guardes credenciales reales en el repo. Usa variables en el compose (ej. `${DB_PASSWORD}`) e indica que se cargarán desde la interfaz de Portainer. Guia al usuario para que cargue las credenciales correctas en cada nuevo deploy.

---

## ESTRATEGIA DE PIPELINE Y ENTORNOS

Los proyectos usan dos ramas como minimo: `dev` y `main` (Prod).
El pipeline `.github/workflows/docker-build.yml` DEBE etiquetar la imagen dinámicamente según la rama para evitar que el entorno de desarrollo pise las imágenes de producción.

Utiliza EXACTAMENTE esta base para el workflow de GitHub Actions:

```yaml
name: Build and Push to GHCR

on:
  push:
    branches: [ dev, main ]

env:
  REGISTRY: ghcr.io

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Preparar variables (Minúsculas y Rama)
        run: |
          echo "REPO_LC=${GITHUB_REPOSITORY,,}" >> ${GITHUB_ENV}
          echo "BRANCH_NAME=${GITHUB_REF_NAME}" >> ${GITHUB_ENV}

      - name: Login en GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # EJEMPLO PARA SERVICIO (Ajustar context y tags según corresponda)
      - name: Build and push Image
        uses: docker/build-push-action@v5
        with:
          context: ./
          push: true
          tags: ${{ env.REGISTRY }}/${{ env.REPO_LC }}:${{ env.BRANCH_NAME }}
