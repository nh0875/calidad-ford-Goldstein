import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import { recibirXlsx } from "../middlewares/uploadXlsx";
import { confirmUpload, listUploads, previewUpload } from "../controllers/upload.controller";
import { confirmFord, previewFord } from "../controllers/encuesta-ford.controller";
import { eliminarUpload } from "../controllers/admin.controller";
import { requireRefuerzo } from "../middlewares/marca";

const router = Router();

// Paso 1: subir el archivo y obtener el preview (no guarda nada en la base).
// recibirXlsx valida tamaño (20 MB), extensión/mimetype y el contenido real.
router.post("/", recibirXlsx("archivo"), asyncHandler(previewUpload));

// Paso 2: confirmar qué hojas importar, con qué mapeo y para qué sucursal
router.post("/confirm", asyncHandler(confirmUpload));

// --- Encuesta Ford (Parte B): flujo de carga propio, mismo patrón ---
// Detrás de requireRefuerzo: es el circuito de la encuesta de fábrica de FORD.
// Sin esto, en Volkswagen la API aceptaba el archivo igual (la solapa está
// escondida, pero esconder no es cortar) y lo procesaba con el lector
// equivocado. El middleware va ANTES de recibirXlsx para que VW ni siquiera
// levante el archivo a memoria.
router.post("/ford", requireRefuerzo, recibirXlsx("archivo"), asyncHandler(previewFord));
router.post("/ford/confirm", requireRefuerzo, asyncHandler(confirmFord));

// Historial de cargas con sus KPIs de resumen
router.get("/", asyncHandler(listUploads));

// Borrado lógico de una carga (solo ADMIN); recuperable desde /api/admin/restaurar
router.delete("/:id", requireAdmin, asyncHandler(eliminarUpload));

export default router;
