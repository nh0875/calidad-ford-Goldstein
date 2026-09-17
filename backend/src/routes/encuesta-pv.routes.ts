import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import {
  editarEstadoEncuestaPV,
  listarEncuestaPV,
  pendientesEncuestaPV,
  motivoSinAccesoPV,
  seguimientoEncuestaPV,
} from "../controllers/encuesta-pv.controller";
import { cerrarMes, clientesDelMesCerrado, listarMeses, reabrirMes } from "../controllers/cierre-periodo.controller";
import { requireAdmin } from "../middlewares/auth";
import { ListaCierre } from "@prisma/client";

// Encuestas de fábrica de Posventa: los promotores de 5 estrellas que Calidad anima
// a responder la encuesta de fábrica. Ninguna ruta pide administrador: es el
// trabajo diario de Calidad (el controlador acota la lista por área y provincia).

const router = Router();

// La lista para trabajar. Sincroniza con los análisis antes de responder.
router.get("/", asyncHandler(listarEncuestaPV));

// Cuántos pendientes hay, para el contador del menú.
router.get("/pendientes", asyncHandler(pendientesEncuestaPV));

// Gráficos mes a mes: los ve cualquier perfil.
router.get("/seguimiento", asyncHandler(seguimientoEncuestaPV));

// Pendiente / Animado / Respondió.
router.patch("/clientes/:id", asyncHandler(editarEstadoEncuestaPV));

// Cierre de meses (ver services/cierre-periodo.service.ts), con el mismo control de
// acceso que la lista: quien no trabaja la lista tampoco cierra sus meses. Reabrir,
// solo administradores.
const LISTA = ListaCierre.ENCUESTA_PV;
router.get("/cierres", asyncHandler(listarMeses(LISTA, motivoSinAccesoPV)));
router.post("/cierres", asyncHandler(cerrarMes(LISTA, motivoSinAccesoPV)));
router.post("/cierres/reabrir", requireAdmin, asyncHandler(reabrirMes(LISTA, motivoSinAccesoPV)));
router.get("/cierres/clientes", asyncHandler(clientesDelMesCerrado(LISTA, motivoSinAccesoPV)));

export default router;
