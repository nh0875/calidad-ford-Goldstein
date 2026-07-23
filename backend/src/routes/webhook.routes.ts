import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { recibirWebhook, verificarWebhook } from "../controllers/webhook.controller";

const router = Router();

// Verificación inicial que hace Meta al configurar el webhook (async: lee el
// verify token de /configuracion)
router.get("/whatsapp", asyncHandler(verificarWebhook));

// Notificaciones de Meta: mensajes entrantes y acuses de entrega
router.post("/whatsapp", asyncHandler(recibirWebhook));

export default router;
