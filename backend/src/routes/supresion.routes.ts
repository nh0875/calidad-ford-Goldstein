import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import { addSupresion, listSupresion, removeSupresion } from "../controllers/supresion.controller";

const router = Router();

// Toda la gestión de la lista de supresión es solo ADMIN.
router.get("/", requireAdmin, asyncHandler(listSupresion));
router.post("/", requireAdmin, asyncHandler(addSupresion));
router.delete("/:id", requireAdmin, asyncHandler(removeSupresion));

export default router;
