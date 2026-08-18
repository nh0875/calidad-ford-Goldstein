-- Encuestas de fabrica de Volkswagen: lista de clientes que le deben la
-- encuesta a fabrica, y los vendedores a los que se les avisa por mail.
-- Es una lista APARTE de Caso: estos clientes no traen telefono, asi que
-- nunca pueden entrar al circuito de WhatsApp.

-- CreateEnum
CREATE TYPE "EstadoEncuestaFabrica" AS ENUM ('PENDIENTE', 'RESPONDIO');

-- AlterEnum
ALTER TYPE "TipoUpload" ADD VALUE 'ENCUESTA_FABRICA_VW';

-- CreateTable
CREATE TABLE "VendedorVW" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "codigoSucursal" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "sucursal" TEXT NOT NULL,
    "nombre" TEXT,
    "email" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "ultimoAvisoEn" TIMESTAMP(3),

    CONSTRAINT "VendedorVW_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncuestaFabricaVW" (
    "id" TEXT NOT NULL,
    "chasis" TEXT NOT NULL,
    "dominio" TEXT,
    "estado" "EstadoEncuestaFabrica" NOT NULL DEFAULT 'PENDIENTE',
    "nombreCliente" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fechaEntrega" TIMESTAMP(3),
    "canalVentas" TEXT,
    "area" TEXT,
    "vendedorId" TEXT NOT NULL,
    "sucursal" TEXT NOT NULL,
    "observacionesFabrica" TEXT[],
    "origenUploadId" TEXT NOT NULL,
    "vistaEnUploadId" TEXT,
    "detectadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondioEn" TIMESTAMP(3),

    CONSTRAINT "EncuestaFabricaVW_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendedorVW_codigo_key" ON "VendedorVW"("codigo");

-- CreateIndex
CREATE INDEX "VendedorVW_codigoSucursal_idx" ON "VendedorVW"("codigoSucursal");

-- CreateIndex
CREATE INDEX "VendedorVW_activo_idx" ON "VendedorVW"("activo");

-- CreateIndex
CREATE UNIQUE INDEX "EncuestaFabricaVW_chasis_key" ON "EncuestaFabricaVW"("chasis");

-- CreateIndex
CREATE INDEX "EncuestaFabricaVW_estado_vendedorId_idx" ON "EncuestaFabricaVW"("estado", "vendedorId");

-- CreateIndex
CREATE INDEX "EncuestaFabricaVW_sucursal_estado_idx" ON "EncuestaFabricaVW"("sucursal", "estado");

-- CreateIndex
CREATE INDEX "EncuestaFabricaVW_vistaEnUploadId_idx" ON "EncuestaFabricaVW"("vistaEnUploadId");

-- AddForeignKey
ALTER TABLE "EncuestaFabricaVW" ADD CONSTRAINT "EncuestaFabricaVW_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "VendedorVW"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncuestaFabricaVW" ADD CONSTRAINT "EncuestaFabricaVW_origenUploadId_fkey" FOREIGN KEY ("origenUploadId") REFERENCES "ExcelUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

