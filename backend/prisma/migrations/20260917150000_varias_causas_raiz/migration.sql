-- Varias causas raíz por RQR y por análisis (las dos marcas, 17-09-2026).
--
-- La causa que ya tenía cada RQR y cada análisis pasa a ser el único elemento de la
-- lista nueva, así no se pierde ninguna clasificación; después se borra la columna
-- vieja. Escrita a mano: ver la nota sobre la deriva previa en
-- 20260917120000_cierre_periodos_indicadores_cem.

-- RQR
ALTER TABLE "RQR" ADD COLUMN "causasRaiz" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "RQR" SET "causasRaiz" = ARRAY["causaRaiz"] WHERE "causaRaiz" IS NOT NULL AND "causaRaiz" <> '';
ALTER TABLE "RQR" DROP COLUMN "causaRaiz";

-- SentimentAnalysis
ALTER TABLE "SentimentAnalysis" ADD COLUMN "categoriasCausaRaiz" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "SentimentAnalysis" SET "categoriasCausaRaiz" = ARRAY["categoriaCausaRaiz"] WHERE "categoriaCausaRaiz" IS NOT NULL AND "categoriaCausaRaiz" <> '';
ALTER TABLE "SentimentAnalysis" DROP COLUMN "categoriaCausaRaiz";
