import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import routes from "./routes";
import { RequestConCuerpoCrudo } from "./middlewares/firmaMeta";

export function createApp() {
  const app = express();

  // Cuántos proxies hay adelante (ver TRUST_PROXY en config/env.ts): de eso
  // depende que req.ip sea el del usuario, que es la clave del límite por IP.
  app.set("trust proxy", env.trustProxy);

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

  app.use(
    express.json({
      limit: "10mb",
      // El webhook necesita el cuerpo EXACTO como llegó para verificar la firma
      // de Meta: el JSON ya parseado y vuelto a serializar no da el mismo HMAC.
      // Se guarda solo ahí, para no duplicar en memoria cada request de la API.
      verify: (req, _res, buf) => {
        if (req.url?.startsWith("/api/webhooks")) (req as RequestConCuerpoCrudo).rawBody = buf;
      },
    })
  );

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
