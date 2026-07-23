import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAuth } from "../middlewares/auth";
import { cambiarPassword, login, logout, yo } from "../controllers/auth.controller";

const router = Router();

// Público: es la puerta de entrada, no puede exigir el JWT que todavía no existe
router.post("/login", asyncHandler(login));

// Protegidas: requieren sesión ya iniciada
router.get("/yo", requireAuth, asyncHandler(yo));
router.post("/logout", requireAuth, asyncHandler(logout));
router.post("/cambiar-password", requireAuth, asyncHandler(cambiarPassword));

export default router;
