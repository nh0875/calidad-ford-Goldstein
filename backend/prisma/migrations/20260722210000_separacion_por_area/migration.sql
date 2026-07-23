-- Separación por área VENTAS / POSVENTA.

-- CreateEnum
CREATE TYPE "AreaTrabajo" AS ENUM ('VENTAS', 'POSVENTA');
CREATE TYPE "AreaUsuario" AS ENUM ('VENTAS', 'POSVENTA', 'AMBAS');

-- Nuevo tipo de carga (Contacto Ventas → casos de área VENTAS)
ALTER TYPE "TipoUpload" ADD VALUE 'CONTACTO_VENTAS';

-- AlterTable: los casos y RQR existentes quedan en POSVENTA (vienen del Contacto
-- Posventa, que es data de taller); los usuarios existentes quedan en AMBAS para
-- no restringir a nadie de golpe.
ALTER TABLE "Caso" ADD COLUMN "area" "AreaTrabajo" NOT NULL DEFAULT 'POSVENTA';
ALTER TABLE "RQR" ADD COLUMN "area" "AreaTrabajo" NOT NULL DEFAULT 'POSVENTA';
ALTER TABLE "Usuario" ADD COLUMN "area" "AreaUsuario" NOT NULL DEFAULT 'AMBAS';

-- CreateIndex
CREATE INDEX "Caso_area_idx" ON "Caso"("area");
CREATE INDEX "RQR_area_idx" ON "RQR"("area");
