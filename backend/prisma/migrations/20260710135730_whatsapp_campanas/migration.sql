-- AlterTable
ALTER TABLE "Caso" ADD COLUMN     "ultimoErrorEnvio" TEXT;

-- CreateTable
CREATE TABLE "MensajeHuerfano" (
    "id" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "waMessageId" TEXT,
    "content" TEXT NOT NULL,
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MensajeHuerfano_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MensajeHuerfano_telefono_idx" ON "MensajeHuerfano"("telefono");
