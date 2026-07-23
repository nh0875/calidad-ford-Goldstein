-- Normalización de asesor/sucursal + lista de supresión por teléfono.

-- CreateEnum
CREATE TYPE "MotivoSupresion" AS ENUM ('OPT_OUT_WHATSAPP', 'SOLICITUD_MANUAL', 'NUMERO_INVALIDO', 'OTRO');
CREATE TYPE "TipoAlias" AS ENUM ('ASESOR', 'SUCURSAL');

-- AlterTable Caso: normalización de asesor/sucursal + teléfonos normalizados
ALTER TABLE "Caso" ADD COLUMN "asesorCodigo" TEXT;
ALTER TABLE "Caso" ADD COLUMN "asesorRaw" TEXT;
ALTER TABLE "Caso" ADD COLUMN "sucursalRaw" TEXT;
ALTER TABLE "Caso" ADD COLUMN "telefonosNorm" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Preservar el valor original antes de normalizar (el script de normalización
-- reescribe asesor/sucursal; asesorRaw/sucursalRaw guardan lo que vino del Excel).
UPDATE "Caso" SET "asesorRaw" = "asesor", "sucursalRaw" = "sucursal";

-- CreateTable SupresionContacto
CREATE TABLE "SupresionContacto" (
    "id" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "motivo" "MotivoSupresion" NOT NULL,
    "casoOrigenId" TEXT,
    "creadoPorId" TEXT,
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupresionContacto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupresionContacto_telefono_key" ON "SupresionContacto"("telefono");
CREATE INDEX "SupresionContacto_motivo_idx" ON "SupresionContacto"("motivo");
CREATE INDEX "SupresionContacto_creadoEn_idx" ON "SupresionContacto"("creadoEn");
ALTER TABLE "SupresionContacto" ADD CONSTRAINT "SupresionContacto_casoOrigenId_fkey" FOREIGN KEY ("casoOrigenId") REFERENCES "Caso"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupresionContacto" ADD CONSTRAINT "SupresionContacto_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable AliasNormalizacion
CREATE TABLE "AliasNormalizacion" (
    "id" TEXT NOT NULL,
    "tipo" "TipoAlias" NOT NULL,
    "claveOrigen" TEXT NOT NULL,
    "valorCanonico" TEXT NOT NULL,
    "codigoCanonico" TEXT,
    "creadoPorId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AliasNormalizacion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AliasNormalizacion_tipo_claveOrigen_key" ON "AliasNormalizacion"("tipo", "claveOrigen");
CREATE INDEX "AliasNormalizacion_tipo_idx" ON "AliasNormalizacion"("tipo");
ALTER TABLE "AliasNormalizacion" ADD CONSTRAINT "AliasNormalizacion_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
