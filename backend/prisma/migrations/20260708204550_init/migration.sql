-- CreateEnum
CREATE TYPE "TipoUpload" AS ENUM ('CONTACTO_POSVENTA');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PROCESANDO', 'COMPLETADO', 'ERROR');

-- CreateEnum
CREATE TYPE "OrigenAgendamiento" AS ENUM ('DEALER', 'FORDPASS', 'ONLINEBOOKING', 'OTRO');

-- CreateEnum
CREATE TYPE "EstadoContacto" AS ENUM ('PENDIENTE', 'ENVIADO', 'RESPONDIDO', 'NO_RESPONDIO', 'INTERNO', 'ERROR');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('ENTRANTE', 'SALIENTE');

-- CreateEnum
CREATE TYPE "Semaforo" AS ENUM ('VERDE', 'AMARILLO', 'ROJO');

-- CreateEnum
CREATE TYPE "EstadoRQR" AS ENUM ('ABIERTO', 'EN_TRATAMIENTO', 'CERRADO');

-- CreateTable
CREATE TABLE "ExcelUpload" (
    "id" TEXT NOT NULL,
    "tipo" "TipoUpload" NOT NULL DEFAULT 'CONTACTO_POSVENTA',
    "filename" TEXT NOT NULL,
    "sucursal" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "columnMapping" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PROCESANDO',

    CONSTRAINT "ExcelUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Caso" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "numeroOrden" TEXT NOT NULL,
    "fechaProgramacion" TIMESTAMP(3) NOT NULL,
    "hora" TEXT,
    "origenAgendamiento" "OrigenAgendamiento" NOT NULL DEFAULT 'DEALER',
    "asesor" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "patente" TEXT NOT NULL,
    "chasisVIN" TEXT,
    "nombrePropietario" TEXT NOT NULL,
    "emailPropietario" TEXT,
    "celular" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "comentarioAsesor" TEXT,
    "fechaSalida" TIMESTAMP(3),
    "diasEnServicio" INTEGER,
    "sucursal" TEXT NOT NULL,
    "estadoContacto" "EstadoContacto" NOT NULL DEFAULT 'PENDIENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Caso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "casoId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "content" TEXT NOT NULL,
    "templateName" TEXT,
    "waMessageId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentimentAnalysis" (
    "id" TEXT NOT NULL,
    "casoId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "semaforo" "Semaforo" NOT NULL,
    "confianza" DOUBLE PRECISION NOT NULL,
    "categoriaCausaRaiz" TEXT,
    "resumenIA" TEXT NOT NULL,
    "respuestaCrudaIA" JSONB NOT NULL,
    "requiereRQR" BOOLEAN NOT NULL DEFAULT false,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentimentAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RQR" (
    "id" TEXT NOT NULL,
    "casoId" TEXT NOT NULL,
    "sentimentAnalysisId" TEXT,
    "numeroRQR" TEXT NOT NULL,
    "fechaApertura" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canal" TEXT NOT NULL DEFAULT 'Posventa',
    "areaOrigen" TEXT NOT NULL,
    "areaAfectada" TEXT,
    "asesor" TEXT NOT NULL,
    "descripcionReclamo" TEXT NOT NULL,
    "tratamientoBitacora" TEXT,
    "solucionPropuesta" TEXT,
    "tratamientoDadoPor" TEXT,
    "fechaCierre" TIMESTAMP(3),
    "observaciones" TEXT,
    "responsableCierre" TEXT,
    "causaRaiz" TEXT,
    "estado" "EstadoRQR" NOT NULL DEFAULT 'ABIERTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RQR_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExcelUpload_sucursal_periodo_idx" ON "ExcelUpload"("sucursal", "periodo");

-- CreateIndex
CREATE INDEX "Caso_uploadId_idx" ON "Caso"("uploadId");

-- CreateIndex
CREATE INDEX "Caso_sucursal_estadoContacto_idx" ON "Caso"("sucursal", "estadoContacto");

-- CreateIndex
CREATE INDEX "Caso_numeroOrden_idx" ON "Caso"("numeroOrden");

-- CreateIndex
CREATE INDEX "WhatsappMessage_casoId_idx" ON "WhatsappMessage"("casoId");

-- CreateIndex
CREATE INDEX "WhatsappMessage_waMessageId_idx" ON "WhatsappMessage"("waMessageId");

-- CreateIndex
CREATE INDEX "SentimentAnalysis_casoId_idx" ON "SentimentAnalysis"("casoId");

-- CreateIndex
CREATE INDEX "SentimentAnalysis_semaforo_idx" ON "SentimentAnalysis"("semaforo");

-- CreateIndex
CREATE UNIQUE INDEX "RQR_sentimentAnalysisId_key" ON "RQR"("sentimentAnalysisId");

-- CreateIndex
CREATE UNIQUE INDEX "RQR_numeroRQR_key" ON "RQR"("numeroRQR");

-- CreateIndex
CREATE INDEX "RQR_casoId_idx" ON "RQR"("casoId");

-- CreateIndex
CREATE INDEX "RQR_estado_idx" ON "RQR"("estado");

-- AddForeignKey
ALTER TABLE "Caso" ADD CONSTRAINT "Caso_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "ExcelUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "Caso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentimentAnalysis" ADD CONSTRAINT "SentimentAnalysis_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "Caso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentimentAnalysis" ADD CONSTRAINT "SentimentAnalysis_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WhatsappMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RQR" ADD CONSTRAINT "RQR_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "Caso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RQR" ADD CONSTRAINT "RQR_sentimentAnalysisId_fkey" FOREIGN KEY ("sentimentAnalysisId") REFERENCES "SentimentAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
