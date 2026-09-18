-- Indicadores CEM por área (Volkswagen, pedido del 18-09-2026): Ventas y Posventa.
--
-- Todo lo que ya estaba cargado es de Ventas (la planilla Q 2026 es de ventas), así
-- que la columna nueva nace en VENTAS y ningún número cambia de lugar. Las claves
-- únicas pasan a incluir el área: el mismo mes de la misma provincia puede tener
-- un renglón de cada área.
CREATE TYPE "AreaCem" AS ENUM ('VENTAS', 'POSVENTA');

ALTER TABLE "IndicadorCemMes" ADD COLUMN "area" "AreaCem" NOT NULL DEFAULT 'VENTAS';
DROP INDEX "IndicadorCemMes_periodo_sucursal_key";
CREATE UNIQUE INDEX "IndicadorCemMes_periodo_sucursal_area_key" ON "IndicadorCemMes"("periodo", "sucursal", "area");

ALTER TABLE "IndicadorCemTrimestre" ADD COLUMN "area" "AreaCem" NOT NULL DEFAULT 'VENTAS';
DROP INDEX "IndicadorCemTrimestre_anio_trimestre_sucursal_key";
CREATE UNIQUE INDEX "IndicadorCemTrimestre_anio_trimestre_sucursal_area_key" ON "IndicadorCemTrimestre"("anio", "trimestre", "sucursal", "area");

ALTER TABLE "ObjetivoCemTrimestre" ADD COLUMN "area" "AreaCem" NOT NULL DEFAULT 'VENTAS';
DROP INDEX "ObjetivoCemTrimestre_anio_trimestre_key";
CREATE UNIQUE INDEX "ObjetivoCemTrimestre_anio_trimestre_area_key" ON "ObjetivoCemTrimestre"("anio", "trimestre", "area");
