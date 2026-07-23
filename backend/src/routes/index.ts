import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { rateLimitGlobal } from "../middlewares/rateLimit";
import healthRoutes from "./health.routes";
import authRoutes from "./auth.routes";
import webhookRoutes from "./webhook.routes";
import uploadRoutes from "./upload.routes";
import casoRoutes from "./caso.routes";
import rqrRoutes from "./rqr.routes";
import reporteRoutes from "./reporte.routes";
import campanaRoutes from "./campana.routes";
import sentimentRoutes from "./sentiment.routes";
import dashboardRoutes from "./dashboard.routes";
import usuarioRoutes from "./usuario.routes";
import auditoriaRoutes from "./auditoria.routes";
import sistemaRoutes from "./sistema.routes";
import adminRoutes from "./admin.routes";
import demoRoutes from "./demo.routes";
import configuracionRoutes from "./configuracion.routes";
import refuerzoRoutes from "./refuerzo.routes";
import supresionRoutes from "./supresion.routes";
import normalizacionRoutes from "./normalizacion.routes";

const router = Router();

// ---------- Rutas sin rate limit global ----------
// /health: lo consultan monitoreos automáticos, no debe verse limitado.
// /webhooks: Meta entrega mensajes en ráfagas desde pocas IPs; se protege sola
// con META_WEBHOOK_VERIFY_TOKEN y no debe caer bajo el límite por IP.
router.use("/health", healthRoutes);
router.use("/webhooks", webhookRoutes);

// ---------- A partir de acá, límite general por IP (anti abuso / loops) ----------
router.use(rateLimitGlobal);

// /auth: pública (login) pero limitada; el login tiene además su propio
// bloqueo por email tras varios intentos fallidos.
router.use("/auth", authRoutes);

// ---------- A partir de acá, todo requiere sesión iniciada ----------
router.use(requireAuth);

router.use("/uploads", uploadRoutes);
router.use("/casos", casoRoutes);
router.use("/rqr", rqrRoutes);
router.use("/reportes", reporteRoutes);
router.use("/campanas", campanaRoutes);
router.use("/sentiment-analysis", sentimentRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/usuarios", usuarioRoutes); // además exige rol ADMIN adentro
router.use("/auditoria", auditoriaRoutes); // solo ADMIN adentro
router.use("/sistema", sistemaRoutes); // solo ADMIN adentro
router.use("/admin", adminRoutes); // solo ADMIN adentro (restaurar borrados)
router.use("/demo", demoRoutes); // simulación para demostraciones (MODO_DEMO)
router.use("/configuracion", configuracionRoutes); // textos de mensajes automáticos
router.use("/refuerzos", refuerzoRoutes); // tareas de refuerzo de encuesta Ford
router.use("/supresion", supresionRoutes); // lista de supresión por teléfono (solo ADMIN)
router.use("/normalizacion", normalizacionRoutes); // normalización de asesores/sucursales (solo ADMIN)

export default router;
