import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { getDashboardResumen } from "../controllers/dashboard.controller";

const router = Router();

// Resumen general (default: últimos 30 días; filtros: fechaDesde/fechaHasta/sucursal)
router.get("/resumen", asyncHandler(getDashboardResumen));

export default router;
