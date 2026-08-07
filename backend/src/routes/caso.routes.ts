import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import { buscarCasos, crearCasoManual, editarCaso, exportarCasos, listCasos, opcionesCasos } from "../controllers/caso.controller";
import { eliminarCaso } from "../controllers/admin.controller";

const router = Router();

// Opciones reales (sucursal/asesor/período) para los desplegables de filtros
router.get("/opciones", asyncHandler(opcionesCasos));

// Autocompletado por nombre/teléfono/patente/orden (para vincular RQR manual)
router.get("/buscar", asyncHandler(buscarCasos));

// Exportar a Excel todos los casos del filtro actual (sin paginar)
router.get("/exportar", asyncHandler(exportarCasos));

// Listado con paginación y filtros: sucursal, asesor, estadoContacto,
// origenAgendamiento, periodo, fechaDesde/fechaHasta
router.get("/", asyncHandler(listCasos));

// Alta manual de un caso suelto (el cliente que no vino en el Excel).
// No es solo de ADMIN: es la operatoria diaria de Calidad. La restricción por
// área se aplica dentro del controller.
router.post("/", asyncHandler(crearCasoManual));

// Edición de datos de un caso (corregir cargas erróneas). ADMIN y CALIDAD; la
// restricción por área se aplica dentro del controller.
router.patch("/:id", asyncHandler(editarCaso));

// Borrado lógico (solo ADMIN); recuperable desde /api/admin/restaurar
router.delete("/:id", requireAdmin, asyncHandler(eliminarCaso));

export default router;
