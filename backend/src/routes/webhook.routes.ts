import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { rateLimitWebhook } from "../middlewares/rateLimit";
import { recibirWebhook, verificarWebhook } from "../controllers/webhook.controller";
import { verificarFirmaMeta } from "../middlewares/firmaMeta";

const router = Router();

// Verificación inicial que hace Meta al configurar el webhook (async: lee el
// verify token de /configuracion)
router.get("/whatsapp", asyncHandler(verificarWebhook));

// Notificaciones de Meta: mensajes entrantes y acuses de entrega. Límite
// holgado propio (no el global): frena un pico anómalo/loop sin cortar a Meta.
// La firma va DESPUÉS del límite: un aluvión de POST falsos se corta antes de
// gastar CPU calculando HMAC.
router.post("/whatsapp", rateLimitWebhook, verificarFirmaMeta, asyncHandler(recibirWebhook));

export default router;
