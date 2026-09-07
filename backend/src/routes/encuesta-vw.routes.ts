import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAdmin } from "../middlewares/auth";
import { recibirXlsx } from "../middlewares/uploadXlsx";
import {
  confirmEncuestaVW,
  crearEncuestaManualVW,
  crearVendedorVW,
  editarVendedorVW,
  eliminarEncuestaVW,
  eliminarVendedorVW,
  listarEncuestaVW,
  notificarEncuestaVW,
  previewEncuestaVW,
} from "../controllers/encuesta-vw.controller";
import { estadoMailRefuerzo } from "../controllers/refuerzo.controller";

const router = Router();

// Lista de pendientes agrupada por vendedor: la ve cualquiera de Calidad.
router.get("/", asyncHandler(listarEncuestaVW));

// Carga del Excel de fábrica. Es en dos pasos a propósito: la confirmación
// cierra pendientes (los que ya no vienen se dan por respondidos), así que
// primero se muestra el impacto y recién después se toca la base.
// CARGAR datos ya no es exclusivo de administradores: Calidad es quien trabaja
// esta pantalla todos los dias y tener que buscar a un admin para subir un Excel
// no tenia sentido. El rol FIDELIZACION no llega hasta aca: lo corta antes
// acotarPorRol, que es una lista blanca de sus dos pantallas.
// BORRAR (vendedores y clientes) SI sigue siendo solo de administradores.
router.post("/preview", recibirXlsx("archivo"), asyncHandler(previewEncuestaVW));
router.post("/confirm", asyncHandler(confirmEncuestaVW));

// ¿Hay casilla de correo configurada? La pantalla lo consulta para avisar ANTES
// de que aprieten "Avisar a los vendedores". Vive acá y no en /refuerzos porque
// esa ruta está detrás de requireRefuerzo, que en VW da 404: el aviso preventivo
// nunca se mostraba.
router.get("/estado-mail", asyncHandler(estadoMailRefuerzo));

// Aviso por correo a los vendedores con su lista.
// Va ANTES de "/vendedores/:id" para que "notificar" no se lea como un id.
router.post("/notificar", requireAdmin, asyncHandler(notificarEncuestaVW));

// ABM de vendedores: acá se les carga el correo, que es lo que habilita el aviso.
router.post("/vendedores", asyncHandler(crearVendedorVW));
router.patch("/vendedores/:id", asyncHandler(editarVendedorVW));
// Borra el vendedor si no tiene encuestas asociadas; si las tiene, explica
// por que no se puede y ofrece desactivarlo.
router.delete("/vendedores/:id", requireAdmin, asyncHandler(eliminarVendedorVW));

// Alta a mano de un pendiente que no vino en el Excel de fabrica.
router.post("/manual", asyncHandler(crearEncuestaManualVW));

// Saca un cliente de la lista. Si vino del Excel de fabrica y sigue figurando
// ahi, la proxima carga lo vuelve a traer; los cargados a mano no vuelven.
router.delete("/clientes/:id", requireAdmin, asyncHandler(eliminarEncuestaVW));

export default router;
