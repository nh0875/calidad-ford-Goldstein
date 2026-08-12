import { Router } from "express";
import { infoMarca } from "../controllers/marca.controller";

// Identidad de la instancia: qué marca es y qué módulos tiene prendidos.
// Sin autenticación: el login la necesita para mostrar el nombre correcto.
const router = Router();

router.get("/", infoMarca);

export default router;
