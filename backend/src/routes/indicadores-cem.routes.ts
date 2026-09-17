import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import {
  guardarMesCem,
  guardarObjetivosCem,
  guardarTrimestreCem,
  obtenerIndicadoresCem,
} from "../controllers/indicadores-cem.controller";

// Indicadores CEM por trimestre (la planilla "Q" de Calidad de VW). Lo ve cualquier
// perfil; cargan Calidad y los administradores (el controlador lo resuelve).

const router = Router();

router.get("/", asyncHandler(obtenerIndicadoresCem));
router.put("/mes", asyncHandler(guardarMesCem));
router.put("/trimestre", asyncHandler(guardarTrimestreCem));
router.put("/objetivos", asyncHandler(guardarObjetivosCem));

export default router;
