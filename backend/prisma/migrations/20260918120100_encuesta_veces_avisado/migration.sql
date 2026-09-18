-- Cuántas veces se le avisó al vendedor por cada cliente (18-09-2026).
--
-- A los que ya tienen fecha de aviso se les cuenta uno: se les avisó al menos esa
-- vez. Así, si se los vuelve a pasar a pendiente, el próximo mail los manda como
-- recordatorio y no como si fueran nuevos.
ALTER TABLE "EncuestaFabricaVW" ADD COLUMN "vecesAvisado" INTEGER NOT NULL DEFAULT 0;
UPDATE "EncuestaFabricaVW" SET "vecesAvisado" = 1 WHERE "avisadoEn" IS NOT NULL;
