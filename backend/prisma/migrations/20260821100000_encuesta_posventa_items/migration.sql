-- Encuesta de Posventa de VW medida por ITEMS (trato, organizacion,
-- reparacion, lavado y general), cada uno en su propia fila para poder
-- promediar y rankear por item sin pelear con un JSON.

-- CreateEnum
CREATE TYPE "ItemPosventa" AS ENUM ('TRATO', 'ORGANIZACION', 'CALIDAD_REPARACION', 'LAVADO', 'GENERAL');

-- AlterTable
ALTER TABLE "Caso" ADD COLUMN     "encuestaItemsEnviadaEn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EvaluacionPosventa" (
    "id" TEXT NOT NULL,
    "casoId" TEXT NOT NULL,
    "item" "ItemPosventa" NOT NULL,
    "estrellas" INTEGER,
    "comentario" TEXT,
    "analisisId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluacionPosventa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvaluacionPosventa_item_estrellas_idx" ON "EvaluacionPosventa"("item", "estrellas");

-- CreateIndex
CREATE INDEX "EvaluacionPosventa_analisisId_idx" ON "EvaluacionPosventa"("analisisId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluacionPosventa_casoId_item_key" ON "EvaluacionPosventa"("casoId", "item");

-- AddForeignKey
ALTER TABLE "EvaluacionPosventa" ADD CONSTRAINT "EvaluacionPosventa_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "Caso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluacionPosventa" ADD CONSTRAINT "EvaluacionPosventa_analisisId_fkey" FOREIGN KEY ("analisisId") REFERENCES "SentimentAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

