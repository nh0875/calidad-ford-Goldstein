import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import { recibirXlsx } from "../middlewares/uploadXlsx";
import {
  detalleFidelizacion,
  eliminarFidelizacion,
  enviarFidelizacion,
  listarFidelizacion,
  progresoFidelizacion,
  subirFidelizacion,
} from "../controllers/fidelizacion.controller";

const router = Router();

// Subir el Excel de agendamientos: detecta los clientes con service 1°-5°
// pendiente y los deja PENDIENTE (mismo formato Ford, .xls o .xlsx).
router.post("/", recibirXlsx("archivo"), asyncHandler(subirFidelizacion));

// Listado de cargas de fidelización con sus conteos.
router.get("/", asyncHandler(listarFidelizacion));

// Progreso de la cola de envío (antes de /:id para que no lo capture como id).
router.get("/progreso", asyncHandler(progresoFidelizacion));

// Encolar el envío de los recordatorios PENDIENTE de una carga.
router.post("/:id/enviar", asyncHandler(enviarFidelizacion));

// Detalle de una carga (con la lista de clientes detectados).
router.get("/:id", asyncHandler(detalleFidelizacion));

// Borrado lógico de una carga (solo ADMIN).
router.delete("/:id", requireAdmin, asyncHandler(eliminarFidelizacion));

export default router;
