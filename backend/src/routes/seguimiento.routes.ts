import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import {
  contarPendientesSeguimiento,
  listarConversaciones,
  reenviarPlantilla,
  responder,
  verConversacion,
} from "../controllers/seguimiento.controller";

// "WhatsApp interno": lista de conversaciones + hilo + respuesta manual. Todo
// filtrado por área + PROVINCIA del usuario (la autorización fina va adentro de
// cada controller). Cualquier usuario autenticado; no es solo-ADMIN.
const router = Router();

router.get("/", asyncHandler(listarConversaciones));
router.get("/pendientes", asyncHandler(contarPendientesSeguimiento)); // badge del menú (antes de /:casoId)
router.get("/:casoId", asyncHandler(verConversacion));
router.post("/:casoId/responder", asyncHandler(responder));
router.post("/:casoId/reenviar-plantilla", asyncHandler(reenviarPlantilla));

export default router;
