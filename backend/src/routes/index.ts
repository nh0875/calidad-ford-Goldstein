import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAuth } from "../middlewares/auth";
import { rateLimitGlobal } from "../middlewares/rateLimit";
import healthRoutes from "./health.routes";
import marcaRoutes from "./marca.routes";
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
import encuestaVwRoutes from "./encuesta-vw.routes";
import supresionRoutes from "./supresion.routes";
import normalizacionRoutes from "./normalizacion.routes";
import avisoRoutes from "./aviso.routes";
import fidelizacionRoutes from "./fidelizacion.routes";
import { requireEncuestaVW, requireFidelizacion, requireRefuerzo } from "../middlewares/marca";
import seguimientoRoutes from "./seguimiento.routes";

const router = Router();

// ---------- Rutas sin rate limit global ----------
// /health: lo consultan monitoreos automáticos, no debe verse limitado.
// /webhooks: Meta entrega mensajes en ráfagas desde pocas IPs; se protege sola
// con META_WEBHOOK_VERIFY_TOKEN y no debe caer bajo el límite por IP.
router.use("/health", healthRoutes);
// /marca: qué marca es esta instancia y qué módulos tiene. Pública porque la
// pantalla de login ya la necesita (no expone nada sensible).
router.use("/marca", marcaRoutes);
router.use("/webhooks", webhookRoutes);

// ---------- A partir de acá, límite general por IP (anti abuso / loops) ----------
router.use(rateLimitGlobal);

// /auth: pública (login) pero limitada; el login tiene además su propio
// bloqueo por email tras varios intentos fallidos.
router.use("/auth", authRoutes);

// ---------- A partir de acá, todo requiere sesión iniciada ----------
// requireAuth es async (consulta denylist + base): se envuelve en asyncHandler
// para que un fallo de Redis/DB se derive al manejador de errores y no quede
// como una promesa rechazada sin capturar (que podría voltear el proceso).
router.use(asyncHandler(requireAuth));

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
router.use("/refuerzos", requireRefuerzo, refuerzoRoutes); // tareas de refuerzo de la encuesta de fábrica
// Encuestas de fábrica de Volkswagen: lista aparte de Caso (esos clientes no
// traen teléfono) más el ABM de vendedores y el aviso por correo.
router.use("/encuesta-vw", requireEncuestaVW, encuestaVwRoutes);
router.use("/supresion", supresionRoutes); // lista de supresión por teléfono (solo ADMIN)
router.use("/normalizacion", normalizacionRoutes); // normalización de asesores/sucursales (solo ADMIN)
router.use("/avisos", avisoRoutes); // cartel rojo en pantalla (RQR abierto, escaladas, amarillos)
// Fidelización solo existe en las marcas que la usan (Ford sí, Volkswagen no):
// requireFidelizacion responde 404 en las demás, así que ocultar la pestaña en
// el frontend no es la única barrera.
router.use("/fidelizacion", requireFidelizacion, fidelizacionRoutes);
router.use("/seguimiento", seguimientoRoutes); // WhatsApp interno: conversaciones + respuesta manual (por provincia)

export default router;
