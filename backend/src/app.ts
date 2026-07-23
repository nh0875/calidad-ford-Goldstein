import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import routes from "./routes";

export function createApp() {
  const app = express();

  // Detrás de nginx: confiar en el primer proxy para que req.ip refleje el
  // X-Forwarded-For real (necesario para auditoría y rate limiting por IP).
  app.set("trust proxy", 1);

  // Cabeceras de seguridad HTTP estándar (X-Frame-Options, X-Content-Type-Options,
  // Referrer-Policy, HSTS, una CSP básica, etc.). La API sirve solo JSON, así que
  // una CSP restrictiva no rompe nada; el frontend lo sirve nginx aparte.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      // La app corre sobre HTTPS en producción (Meta lo exige para el webhook),
      // pero el certificado lo termina el proxy: dejamos que Helmet mande HSTS.
      crossOriginResourcePolicy: { policy: "same-site" },
    })
  );

  // CORS restrictivo: solo el/los dominio(s) de FRONTEND_URL. En desarrollo
  // (sin FRONTEND_URL) se refleja el origen para no estorbar; en producción sin
  // FRONTEND_URL no se emiten cabeceras CORS (el caso normal es mismo origen
  // detrás de nginx, que no necesita CORS). Nunca "*".
  const origenesPermitidos = env.frontendUrl
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin:
        origenesPermitidos.length > 0
          ? origenesPermitidos
          : env.nodeEnv !== "production"
            ? true
            : false,
      credentials: true,
    })
  );

  app.use(express.json({ limit: "10mb" }));

  app.use("/api", routes);

  // 404 para rutas de API desconocidas
  app.use("/api", (_req, res) => {
    res.status(404).json({ message: "Ruta no encontrada" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api] error no manejado:", err);
    res.status(500).json({
      message:
        "Ocurrió un problema inesperado en el servidor. Volvé a intentar en unos minutos; si sigue pasando, avisá a Sistemas.",
    });
  });

  return app;
}
