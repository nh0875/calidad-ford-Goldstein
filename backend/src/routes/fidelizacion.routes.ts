import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import { recibirXlsx } from "../middlewares/uploadXlsx";
import {
  detalleFidelizacion,
  eliminarFidelizacion,
  enviarFidelizacion,
  estadoPlantillaFidelizacion,
  hojasDelExcel,
  listarFidelizacion,
  progresoFidelizacion,
  subirFidelizacion,
} from "../controllers/fidelizacion.controller";
import {
  crearClienteFidelizacion,
  editarClienteFidelizacion,
  eliminarClienteFidelizacion,
  enviarClienteFidelizacion,
  excluirClienteFidelizacion,
  listarClientesFidelizacion,
} from "../controllers/fidelizacion-cliente.controller";

const router = Router();

// --- Destinatarios (pantalla "Clientes de fidelización") ---
// VAN ANTES de las rutas /:id, si no "clientes" se toma como el id de una carga.
// El alta y la edición NO son solo de ADMIN: son operatoria diaria de Calidad
// (mismo criterio que el alta manual de casos). El borrado sí es de ADMIN.
router.get("/clientes", asyncHandler(listarClientesFidelizacion));
router.post("/clientes", asyncHandler(crearClienteFidelizacion));
router.patch("/clientes/:id", asyncHandler(editarClienteFidelizacion));
router.post("/clientes/:id/excluir", asyncHandler(excluirClienteFidelizacion));
router.post("/clientes/:id/enviar", asyncHandler(enviarClienteFidelizacion));
router.delete("/clientes/:id", requireAdmin, asyncHandler(eliminarClienteFidelizacion));

// Subir el Excel de agendamientos: detecta los clientes con service 1°-5°
// pendiente y los deja PENDIENTE (mismo formato Ford, .xls o .xlsx).
router.post("/", recibirXlsx("archivo"), asyncHandler(subirFidelizacion));

// Las hojas que trae el Excel, para que la pantalla pueda ofrecer cual procesar.
// No persiste nada: solo abre el archivo y devuelve los nombres.
router.post("/hojas", recibirXlsx("archivo"), asyncHandler(hojasDelExcel));

// Listado de cargas de fidelización con sus conteos.
router.get("/", asyncHandler(listarFidelizacion));

// Progreso de la cola de envío (antes de /:id para que no lo capture como id).
router.get("/progreso", asyncHandler(progresoFidelizacion));

// Estado de la plantilla de fidelización en Meta (aprobada / pendiente / ...).
router.get("/plantilla", asyncHandler(estadoPlantillaFidelizacion));

// Encolar el envío de los recordatorios PENDIENTE de una carga.
router.post("/:id/enviar", asyncHandler(enviarFidelizacion));

// Detalle de una carga (con la lista de clientes detectados).
router.get("/:id", asyncHandler(detalleFidelizacion));

// Borrado lógico de una carga (solo ADMIN).
router.delete("/:id", requireAdmin, asyncHandler(eliminarFidelizacion));

export default router;
