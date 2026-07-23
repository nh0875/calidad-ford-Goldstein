import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import {
  crearAlias,
  eliminarAlias,
  listAlias,
  valoresDistintos,
} from "../controllers/normalizacion.controller";

const router = Router();

// Normalización de asesores/sucursales: solo ADMIN.
router.get("/valores", requireAdmin, asyncHandler(valoresDistintos));
router.get("/alias", requireAdmin, asyncHandler(listAlias));
router.post("/alias", requireAdmin, asyncHandler(crearAlias));
router.delete("/alias/:id", requireAdmin, asyncHandler(eliminarAlias));

export default router;
