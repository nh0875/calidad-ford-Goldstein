-- Fidelización (Parte C): recordatorio de service de mantenimiento pendiente.
-- Flujo aparte del Contacto Posventa: NO crea Casos ni clasifica respuestas.

-- AlterEnum: nuevo tipo de carga
ALTER TYPE "TipoUpload" ADD VALUE 'FIDELIZACION';

-- CreateEnum: estado del recordatorio por cliente
CREATE TYPE "EstadoFidelizacion" AS ENUM ('PENDIENTE', 'ENVIADO', 'ERROR', 'OMITIDO');

-- CreateTable
CREATE TABLE "ClienteFidelizacion" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "telefonosNorm" TEXT[],
    "modelo" TEXT,
    "patente" TEXT,
    "asesor" TEXT,
    "numeroServicio" INTEGER NOT NULL,
    "comentarioAsesor" TEXT NOT NULL,
    "sucursal" TEXT,
    "estado" "EstadoFidelizacion" NOT NULL DEFAULT 'PENDIENTE',
    "waMessageId" TEXT,
    "error" TEXT,
    "enviadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClienteFidelizacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClienteFidelizacion_uploadId_idx" ON "ClienteFidelizacion"("uploadId");

-- CreateIndex
CREATE INDEX "ClienteFidelizacion_estado_idx" ON "ClienteFidelizacion"("estado");

-- AddForeignKey
ALTER TABLE "ClienteFidelizacion" ADD CONSTRAINT "ClienteFidelizacion_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "ExcelUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
