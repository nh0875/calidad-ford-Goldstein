import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import {
  listarTareas,
  misPendientes,
  misTareas,
  patchTarea,
  resumenEmpleados,
  vincularTarea,
} from "../controllers/refuerzo.controller";

const router = Router();

// POOL del usuario logueado: todas las tareas de su área + provincia.
router.get("/mias", asyncHandler(misTareas));
router.get("/mias/pendientes", asyncHandler(misPendientes)); // para el badge del sidebar

// Vista de administración (solo ADMIN)
router.get("/", requireAdmin, asyncHandler(listarTareas));
router.get("/resumen-empleados", requireAdmin, asyncHandler(resumenEmpleados));
router.post("/vincular", requireAdmin, asyncHandler(vincularTarea));

// Gestión de una tarea: cualquier integrante del pool (misma área+provincia);
// la autorización de pertenencia al pool se valida en el controller.
router.patch("/:id", asyncHandler(patchTarea));

export default router;
