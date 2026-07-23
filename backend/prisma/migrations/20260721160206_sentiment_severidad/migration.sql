-- CreateEnum
CREATE TYPE "Severidad" AS ENUM ('LEVE', 'MODERADA', 'GRAVE');

-- AlterTable
ALTER TABLE "SentimentAnalysis" ADD COLUMN     "severidad" "Severidad";
