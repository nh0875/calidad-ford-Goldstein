import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { rateLimitWebhook } from "../middlewares/rateLimit";
import { recibirWebhook, verificarWebhook } from "../controllers/webhook.controller";

const router = Router();

// Verificación inicial que hace Meta al configurar el webhook (async: lee el
// verify token de /configuracion)
router.get("/whatsapp", asyncHandler(verificarWebhook));

// Notificaciones de Meta: mensajes entrantes y acuses de entrega. Límite
// holgado propio (no el global): frena un pico anómalo/loop sin cortar a Meta.
router.post("/whatsapp", rateLimitWebhook, asyncHandler(recibirWebhook));

export default router;
