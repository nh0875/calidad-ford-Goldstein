-- Encuestas de fábrica: el MES de cada cliente, para seguir las animaciones mes a mes.
--
-- Calidad necesita ver cómo van las animaciones de cada mes: de los clientes que
-- patentaron en agosto, a cuántos se animó y cuántos contestaron. El mes lo da la
-- columna "Fecha Dominio" del Excel de fábrica, que el lector ya ubicaba pero
-- descartaba sin guardarla.
--
-- EL MES VA EN EL CLIENTE, NO EN LA CARGA. Un Excel de fábrica no es un mes: el
-- de agosto de 2026 trae 48 clientes de julio y 39 de agosto, porque fábrica lista
-- a todos los que deben la encuesta. Etiquetar el archivo entero con un mes
-- contaría a 39 clientes en el mes equivocado.

ALTER TABLE "EncuestaFabricaVW" ADD COLUMN IF NOT EXISTS "fechaDominio" TIMESTAMP(3);
ALTER TABLE "EncuestaFabricaVW" ADD COLUMN IF NOT EXISTS "periodo" TEXT;
CREATE INDEX IF NOT EXISTS "EncuestaFabricaVW_periodo_idx" ON "EncuestaFabricaVW"("periodo");

-- Los clientes que YA estaban no tienen Fecha Dominio guardada: se les estima el
-- mes con la entrega, para que el seguimiento no arranque vacío. Queda marcado
-- como estimación porque fechaDominio sigue en null, y se corrige solo: la próxima
-- carga que traiga a ese cliente le guarda la fecha real.
--
-- to_char sobre la fecha tal cual está guardada es seguro: las entregas del Excel
-- se arman al mediodía, así que ningún huso horario las corre de mes.
UPDATE "EncuestaFabricaVW"
SET "periodo" = to_char("fechaEntrega", 'YYYY-MM')
WHERE "periodo" IS NULL AND "fechaEntrega" IS NOT NULL;
