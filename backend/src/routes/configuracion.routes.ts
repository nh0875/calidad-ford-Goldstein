import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import {
  getConfiguracion,
  getMeta,
  patchConfiguracion,
  patchMeta,
  probarWhatsapp,
} from "../controllers/configuracion.controller";

const router = Router();

// Lectura: cualquier usuario autenticado (para previsualizar los textos).
router.get("/", asyncHandler(getConfiguracion));

// Edición: solo ADMIN.
router.patch("/", requireAdmin, asyncHandler(patchConfiguracion));

// Credenciales de WhatsApp (Meta): estado enmascarado (auth), edición y prueba (ADMIN)
router.get("/whatsapp", asyncHandler(getMeta));
router.patch("/whatsapp", requireAdmin, asyncHandler(patchMeta));
router.post("/whatsapp/probar", requireAdmin, asyncHandler(probarWhatsapp));

export default router;
