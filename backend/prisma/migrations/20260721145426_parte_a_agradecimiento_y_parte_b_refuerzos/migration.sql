-- CreateEnum
CREATE TYPE "EncuestaFordEstado" AS ENUM ('SIN_DATO', 'RESPONDIDA', 'PENDIENTE_RESPUESTA', 'NO_ELEGIBLE', 'EMAIL_INVALIDO');

-- CreateEnum
CREATE TYPE "TipoTareaRefuerzo" AS ENUM ('RECORDAR_ENCUESTA', 'VERIFICAR_EMAIL');

-- CreateEnum
CREATE TYPE "EstadoTareaRefuerzo" AS ENUM ('PENDIENTE', 'EN_GESTION', 'COMPLETADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "ResultadoTareaRefuerzo" AS ENUM ('ENCUESTA_RESPONDIDA', 'NO_CONTESTA', 'DATOS_ERRONEOS', 'RECHAZO', 'OTRO');

-- AlterEnum
ALTER TYPE "TipoUpload" ADD VALUE 'ENCUESTA_FORD';

-- AlterTable
ALTER TABLE "Caso" ADD COLUMN     "agradecimientoEnviadoEn" TIMESTAMP(3),
ADD COLUMN     "encuestaFordEstado" "EncuestaFordEstado" NOT NULL DEFAULT 'SIN_DATO',
ADD COLUMN     "encuestaFordFecha" TIMESTAMP(3),
ADD COLUMN     "whatsappOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "participaEnRefuerzos" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "WhatsappMessage" ADD COLUMN     "esAgradecimiento" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Configuracion" (
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Configuracion_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "TareaRefuerzo" (
    "id" TEXT NOT NULL,
    "casoId" TEXT NOT NULL,
    "tipo" "TipoTareaRefuerzo" NOT NULL,
    "asignadoAId" TEXT,
    "estado" "EstadoTareaRefuerzo" NOT NULL DEFAULT 'PENDIENTE',
    "resultado" "ResultadoTareaRefuerzo",
    "notas" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadaEn" TIMESTAMP(3) NOT NULL,
    "completadaEn" TIMESTAMP(3),
    "origenUploadId" TEXT NOT NULL,

    CONSTRAINT "TareaRefuerzo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TareaRefuerzo_asignadoAId_estado_idx" ON "TareaRefuerzo"("asignadoAId", "estado");

-- CreateIndex
CREATE INDEX "TareaRefuerzo_casoId_idx" ON "TareaRefuerzo"("casoId");

-- CreateIndex
CREATE INDEX "TareaRefuerzo_estado_idx" ON "TareaRefuerzo"("estado");

-- CreateIndex
CREATE INDEX "Caso_encuestaFordEstado_idx" ON "Caso"("encuestaFordEstado");

-- AddForeignKey
ALTER TABLE "TareaRefuerzo" ADD CONSTRAINT "TareaRefuerzo_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "Caso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TareaRefuerzo" ADD CONSTRAINT "TareaRefuerzo_asignadoAId_fkey" FOREIGN KEY ("asignadoAId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TareaRefuerzo" ADD CONSTRAINT "TareaRefuerzo_origenUploadId_fkey" FOREIGN KEY ("origenUploadId") REFERENCES "ExcelUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
