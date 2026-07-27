import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { enviarCampana, previewCampana, progresoCampana, reintentarEnvio } from "../controllers/campana.controller";

const router = Router();

// Cuenta cuántos casos PENDIENTE recibirían el mensaje (no encola nada)
router.get("/preview", asyncHandler(previewCampana));

// Encola el envío real en la cola whatsapp-envio
router.post("/enviar", asyncHandler(enviarCampana));

// Reintenta UN caso cuyo envío falló (vuelve a PENDIENTE y lo reencola)
router.post("/reintentar/:casoId", asyncHandler(reintentarEnvio));

// Estado de la cola para la barra de progreso del frontend
router.get("/progreso", asyncHandler(progresoCampana));

export default router;
