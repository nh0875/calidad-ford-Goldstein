import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import { listAuditoria, opcionesAuditoria } from "../controllers/auditoria.controller";

const router = Router();

// Toda la auditoría es solo ADMIN (requireAuth ya corrió a nivel global).
// Solo lectura: la tabla AuditLog es inmutable, no hay POST/PATCH/DELETE acá.
router.use(requireAdmin);

router.get("/", asyncHandler(listAuditoria));
router.get("/opciones", asyncHandler(opcionesAuditoria));

export default router;
