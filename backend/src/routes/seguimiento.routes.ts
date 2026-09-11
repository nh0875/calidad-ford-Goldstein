import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import {
  cargarResultadoLlamada,
  mandarSegundoContacto,
  marcarLlamadaFallida,
  verResultadoLlamada,
} from "../controllers/llamada.controller";
import {
  contarPendientesSeguimiento,
  listarConversaciones,
  reenviarPlantilla,
  responder,
  verConversacion,
} from "../controllers/seguimiento.controller";

// "WhatsApp interno": lista de conversaciones + hilo + respuesta manual. Todo
// filtrado por área + PROVINCIA del usuario (la autorización fina va adentro de
// cada controller). Cualquier usuario autenticado; no es solo-ADMIN.
const router = Router();

router.get("/", asyncHandler(listarConversaciones));
router.get("/pendientes", asyncHandler(contarPendientesSeguimiento)); // badge del menú (antes de /:casoId)
router.get("/:casoId", asyncHandler(verConversacion));
router.post("/:casoId/responder", asyncHandler(responder));
router.post("/:casoId/reenviar-plantilla", asyncHandler(reenviarPlantilla));

// El circuito de insistencia (solo Volkswagen; en Ford los tres responden 404
// porque la bandera de marca esta apagada). Van aca y no en /casos porque la
// pantalla desde donde se usan es la del seguimiento del caso.
router.post("/:casoId/segundo-contacto", asyncHandler(mandarSegundoContacto));
// El GET va ANTES del POST solo por prolijidad: son métodos distintos y no
// compiten. Devuelve lo que ya se cargó, para poder corregirlo sin tipear todo
// de nuevo.
router.get("/:casoId/llamada", asyncHandler(verResultadoLlamada));
router.post("/:casoId/llamada", asyncHandler(cargarResultadoLlamada));
router.post("/:casoId/llamada-fallida", asyncHandler(marcarLlamadaFallida));

export default router;
