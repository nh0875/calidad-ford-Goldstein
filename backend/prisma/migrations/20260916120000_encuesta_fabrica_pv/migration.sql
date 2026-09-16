-- Encuestas de fabrica de Posventa (Volkswagen): los promotores de 5 estrellas de la
-- sucursal configurada, que Calidad anima a responder la encuesta de fabrica.
-- Tabla nueva: no toca ningun dato existente. Ver schema.prisma, EncuestaFabricaPV.
--
-- OJO al regenerarla con `prisma migrate diff`: el diff contra la base tambien
-- propone borrar los indices Caso_segundoContactoEn_idx y Usuario_eliminadoEn_idx y
-- rehacer la FK EncuestaFabricaVW_origenUploadId_fkey. Esa diferencia ya existia
-- entre las migraciones anteriores y schema.prisma, no es de este cambio, y NO va
-- aca: borraria indices que estan en uso en las PCs.

-- CreateTable
CREATE TABLE "EncuestaFabricaPV" (
    "id" TEXT NOT NULL,
    "casoId" TEXT NOT NULL,
    "estado" "EstadoEncuestaFabrica" NOT NULL DEFAULT 'PENDIENTE',
    "calificadoEn" TIMESTAMP(3),
    "detectadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "animadoEn" TIMESTAMP(3),
    "respondioEn" TIMESTAMP(3),

    CONSTRAINT "EncuestaFabricaPV_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EncuestaFabricaPV_casoId_key" ON "EncuestaFabricaPV"("casoId");

-- CreateIndex
CREATE INDEX "EncuestaFabricaPV_estado_idx" ON "EncuestaFabricaPV"("estado");

-- AddForeignKey
ALTER TABLE "EncuestaFabricaPV" ADD CONSTRAINT "EncuestaFabricaPV_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "Caso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
