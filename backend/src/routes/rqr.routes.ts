import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import { recibirXlsx } from "../middlewares/uploadXlsx";
import {
  createRqr,
  exportarRqrWord,
  getRqr,
  importarRqr,
  listRqr,
  patchRqr,
} from "../controllers/rqr.controller";
import { eliminarRqr } from "../controllers/admin.controller";

const router = Router();

// Listado con filtros (estado, sucursal, asesor, categoría, rango de fechas)
router.get("/", asyncHandler(listRqr));

// Creación manual (reclamo telefónico/presencial; el automático lo genera la IA)
router.post("/", asyncHandler(createRqr));

// Importación del Excel de formularios RQR (una hoja por RQR), validado.
// Solo ADMIN: es una carga masiva que crea RQR sobre casos de cualquier área,
// así que no la puede disparar un usuario restringido a una sola área.
router.post("/importar", requireAdmin, recibirXlsx("archivo"), asyncHandler(importarRqr));

// Formulario Word con el formato del papel (imprimir / mandar a Ford)
router.get("/:id/word", asyncHandler(exportarRqrWord));

// Detalle para la pantalla /rqr/:id
router.get("/:id", asyncHandler(getRqr));

// Tratamiento / cierre por Calidad (recalcula Caso.tieneRqrAbierto)
router.patch("/:id", asyncHandler(patchRqr));

// Borrado lógico (solo ADMIN); recuperable desde /api/admin/restaurar
router.delete("/:id", requireAdmin, asyncHandler(eliminarRqr));

export default router;
