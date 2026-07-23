import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import {
  createUsuario,
  listUsuarios,
  patchUsuario,
  resetearPassword,
} from "../controllers/usuario.controller";

const router = Router();

// Toda esta sección requiere ADMIN. requireAuth ya corrió a nivel global
// (ver routes/index.ts); acá solo falta exigir el rol.
router.use(requireAdmin);

router.get("/", asyncHandler(listUsuarios));
router.post("/", asyncHandler(createUsuario));
router.patch("/:id/resetear-password", asyncHandler(resetearPassword));
router.patch("/:id", asyncHandler(patchUsuario));

export default router;
