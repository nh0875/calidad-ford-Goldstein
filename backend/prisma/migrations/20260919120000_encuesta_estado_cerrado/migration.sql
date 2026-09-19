-- Estado "Cerrado" para Encuestas de fábrica PV (19-09-2026): se dejó de trabajar
-- al cliente sin que respondiera. El enum es el mismo que usan las encuestas de
-- Ventas, que no lo ofrecen ni lo aceptan.
ALTER TYPE "EstadoEncuestaFabrica" ADD VALUE 'CERRADO';
