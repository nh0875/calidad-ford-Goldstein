import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import { recibirXlsx } from "../middlewares/uploadXlsx";
import {
  confirmEncuestaVW,
  crearVendedorVW,
  editarVendedorVW,
  listarEncuestaVW,
  notificarEncuestaVW,
  previewEncuestaVW,
} from "../controllers/encuesta-vw.controller";

const router = Router();

// Lista de pendientes agrupada por vendedor: la ve cualquiera de Calidad.
router.get("/", asyncHandler(listarEncuestaVW));

// Carga del Excel de fábrica. Es en dos pasos a propósito: la confirmación
// cierra pendientes (los que ya no vienen se dan por respondidos), así que
// primero se muestra el impacto y recién después se toca la base.
router.post("/preview", requireAdmin, recibirXlsx("archivo"), asyncHandler(previewEncuestaVW));
router.post("/confirm", requireAdmin, asyncHandler(confirmEncuestaVW));

// Aviso por correo a los vendedores con su lista.
// Va ANTES de "/vendedores/:id" para que "notificar" no se lea como un id.
router.post("/notificar", requireAdmin, asyncHandler(notificarEncuestaVW));

// ABM de vendedores: acá se les carga el correo, que es lo que habilita el aviso.
router.post("/vendedores", requireAdmin, asyncHandler(crearVendedorVW));
router.patch("/vendedores/:id", requireAdmin, asyncHandler(editarVendedorVW));

export default router;
