import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import { contarCasosInternos, eliminarCasosInternos, restaurar } from "../controllers/admin.controller";

const router = Router();

// Acciones administrativas sensibles, solo ADMIN.
router.use(requireAdmin);

// Revertir un borrado lógico: tipo ∈ caso | rqr | upload
router.post("/restaurar/:tipo/:id", asyncHandler(restaurar));

// Los casos internos, todos de una vez (solo en las marcas que no los cargan).
router.get("/casos-internos", asyncHandler(contarCasosInternos));
router.post("/casos-internos/eliminar", asyncHandler(eliminarCasosInternos));

export default router;
