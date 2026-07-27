import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import {
  listarTareas,
  misPendientes,
  misTareas,
  patchTarea,
  reasignarTarea,
  redistribuirTareas,
  resumenEmpleados,
  vincularTarea,
} from "../controllers/refuerzo.controller";

const router = Router();

// Tareas del usuario logueado (cualquier rol que tenga tareas asignadas)
router.get("/mias", asyncHandler(misTareas));
router.get("/mias/pendientes", asyncHandler(misPendientes)); // para el badge del sidebar

// Vista de administración (solo ADMIN)
router.get("/", requireAdmin, asyncHandler(listarTareas));
router.get("/resumen-empleados", requireAdmin, asyncHandler(resumenEmpleados));
router.post("/:id/reasignar", requireAdmin, asyncHandler(reasignarTarea));
router.post("/redistribuir", requireAdmin, asyncHandler(redistribuirTareas));
router.post("/vincular", requireAdmin, asyncHandler(vincularTarea));

// Gestión de una tarea (dueño o ADMIN; la autorización se valida en el controller)
router.patch("/:id", asyncHandler(patchTarea));

export default router;
