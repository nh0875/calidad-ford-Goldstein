import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import { restaurar } from "../controllers/admin.controller";

const router = Router();

// Acciones administrativas sensibles, solo ADMIN.
router.use(requireAdmin);

// Revertir un borrado lógico: tipo ∈ caso | rqr | upload
router.post("/restaurar/:tipo/:id", asyncHandler(restaurar));

export default router;
