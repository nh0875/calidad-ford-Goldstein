-- Varias subáreas por RQR (Volkswagen, pedido del dueño del 17-09-2026).
--
-- La subárea que ya tenía cada RQR pasa a ser el primer elemento de la lista, así
-- no se pierde nada de lo clasificado hasta hoy. En Ford la columna siempre fue
-- null y las listas quedan vacías, como estaban.
ALTER TABLE "RQR" ADD COLUMN "subareas" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "RQR" SET "subareas" = ARRAY["subarea"] WHERE "subarea" IS NOT NULL AND "subarea" <> '';
ALTER TABLE "RQR" DROP COLUMN "subarea";
