import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Hosts permitidos por el dev server de Vite (evita "Blocked request" al exponer
// por ngrok u otro dominio). Se leen de VITE_ALLOWED_HOSTS (separados por coma);
// un host con punto inicial (".ngrok-free.app") permite todos sus subdominios.
// "true" o "*" permite cualquier host. NOTA: esto es solo para el dev server;
// en producción el frontend lo sirve nginx estático y este chequeo no existe.
const raw = process.env.VITE_ALLOWED_HOSTS?.trim();
const allowedHosts: true | string[] | undefined =
  raw === "true" || raw === "*"
    ? true
    : raw
      ? raw.split(",").map((h) => h.trim()).filter(Boolean)
      : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts,
    // El proxy /api lo maneja nginx en Docker; esto sirve para dev local sin Docker
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
