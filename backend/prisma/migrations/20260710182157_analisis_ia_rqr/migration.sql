-- AlterTable
ALTER TABLE "Caso" ADD COLUMN     "tieneRqrAbierto" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SentimentAnalysis" ADD COLUMN     "requiereRevisionManual" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "semaforo" DROP NOT NULL;
