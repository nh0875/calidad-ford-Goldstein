-- Nuevo tipo de aviso: un caso que necesita revisión manual (la IA no pudo
-- clasificar la respuesta del cliente). Sirve para el cartel de avisos, así
-- nadie se pasa de las 24 h sin mirarlo.
ALTER TYPE "TipoAviso" ADD VALUE IF NOT EXISTS 'REVISION_MANUAL';
