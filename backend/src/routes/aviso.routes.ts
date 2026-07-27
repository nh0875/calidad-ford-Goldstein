import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { listAvisos, marcarAvisoVisto, marcarTodosVistos } from "../controllers/aviso.controller";

const router = Router();

// Avisos vigentes del área del usuario (alimentan el cartel rojo del encabezado)
router.get("/", asyncHandler(listAvisos));

// Apagar un aviso puntual, o todos los que estén a la vista
router.post("/vistos", asyncHandler(marcarTodosVistos));
router.post("/:id/visto", asyncHandler(marcarAvisoVisto));

export default router;
