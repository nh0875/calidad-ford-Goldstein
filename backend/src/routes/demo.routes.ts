import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { estadoDemo, simularRespuesta, soloModoDemo } from "../controllers/demo.controller";

const router = Router();

// Estado del modo demo: siempre responde (para que el frontend sepa si activarlo).
router.get("/estado", asyncHandler(estadoDemo));

// El resto solo funciona con MODO_DEMO=true.
router.post("/simular-respuesta", soloModoDemo, asyncHandler(simularRespuesta));

export default router;
