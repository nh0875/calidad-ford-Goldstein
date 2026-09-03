import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import { caidas, estadoBackup } from "../controllers/sistema.controller";

const router = Router();

// Estado operativo del sistema, solo ADMIN.
router.use(requireAdmin);

router.get("/estado-backup", asyncHandler(estadoBackup));
// Cuando estuvo caido el sistema, y a quien pudo costarle una respuesta.
router.get("/caidas", asyncHandler(caidas));

export default router;
