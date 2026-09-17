-- Cierre de meses de Encuestas de fábrica (Ventas y PV) e Indicadores CEM por
-- trimestre (Volkswagen, 17-09-2026).
--
-- Escrita a mano: `prisma migrate diff` propone además borrar
-- Caso_segundoContactoEn_idx y Usuario_eliminadoEn_idx y rehacer la FK
-- EncuestaFabricaVW_origenUploadId_fkey. Eso es deriva previa entre las
-- migraciones y schema.prisma, no parte de este cambio, y no se toca.

-- CreateEnum
CREATE TYPE "ListaCierre" AS ENUM ('ENCUESTA_VENTAS', 'ENCUESTA_PV');

-- CreateEnum
CREATE TYPE "OrigenCierre" AS ENUM ('MANUAL', 'AUTOMATICO');

-- AlterTable
ALTER TABLE "EncuestaFabricaPV" ADD COLUMN     "cerradoEn" TIMESTAMP(3),
ADD COLUMN     "periodoCierre" TEXT;

-- AlterTable
ALTER TABLE "EncuestaFabricaVW" ADD COLUMN     "cerradoEn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CierrePeriodo" (
    "id" TEXT NOT NULL,
    "lista" "ListaCierre" NOT NULL,
    "periodo" TEXT NOT NULL,
    "sucursal" TEXT NOT NULL,
    "origen" "OrigenCierre" NOT NULL,
    "cerradoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradoPorId" TEXT,
    "cerradoPorNombre" TEXT,
    "clientesCerrados" INTEGER NOT NULL DEFAULT 0,
    "reabiertoEn" TIMESTAMP(3),
    "reabiertoPorId" TEXT,
    "reabiertoPorNombre" TEXT,

    CONSTRAINT "CierrePeriodo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndicadorCemMes" (
    "id" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "sucursal" TEXT NOT NULL,
    "patentamientos" INTEGER,
    "baseCem" INTEGER,
    "baseCemTradicional" INTEGER,
    "baseCemAutoahorro" INTEGER,
    "encuestasEfectivas" INTEGER,
    "baseSinDuplicados" INTEGER,
    "mailOk" INTEGER,
    "os" DOUBLE PRECISION,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "actualizadoPorNombre" TEXT,

    CONSTRAINT "IndicadorCemMes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndicadorCemTrimestre" (
    "id" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "trimestre" INTEGER NOT NULL,
    "sucursal" TEXT NOT NULL,
    "os" DOUBLE PRECISION,
    "resultadoAuditoria" DOUBLE PRECISION,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "actualizadoPorNombre" TEXT,

    CONSTRAINT "IndicadorCemTrimestre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjetivoCemTrimestre" (
    "id" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "trimestre" INTEGER NOT NULL,
    "os" DOUBLE PRECISION,
    "cargas" DOUBLE PRECISION,
    "mailValidos" DOUBLE PRECISION,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "actualizadoPorNombre" TEXT,

    CONSTRAINT "ObjetivoCemTrimestre_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CierrePeriodo_lista_periodo_sucursal_key" ON "CierrePeriodo"("lista", "periodo", "sucursal");

-- CreateIndex
CREATE UNIQUE INDEX "IndicadorCemMes_periodo_sucursal_key" ON "IndicadorCemMes"("periodo", "sucursal");

-- CreateIndex
CREATE UNIQUE INDEX "IndicadorCemTrimestre_anio_trimestre_sucursal_key" ON "IndicadorCemTrimestre"("anio", "trimestre", "sucursal");

-- CreateIndex
CREATE UNIQUE INDEX "ObjetivoCemTrimestre_anio_trimestre_key" ON "ObjetivoCemTrimestre"("anio", "trimestre");

-- CreateIndex
CREATE INDEX "EncuestaFabricaPV_cerradoEn_idx" ON "EncuestaFabricaPV"("cerradoEn");

-- CreateIndex
CREATE INDEX "EncuestaFabricaVW_cerradoEn_idx" ON "EncuestaFabricaVW"("cerradoEn");
