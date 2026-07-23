import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import { estadoBackup } from "../controllers/sistema.controller";

const router = Router();

// Estado operativo del sistema, solo ADMIN.
router.use(requireAdmin);

router.get("/estado-backup", asyncHandler(estadoBackup));

export default router;
