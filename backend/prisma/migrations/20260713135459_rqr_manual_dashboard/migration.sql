-- DropForeignKey
ALTER TABLE "RQR" DROP CONSTRAINT "RQR_casoId_fkey";

-- AlterTable
ALTER TABLE "RQR" ADD COLUMN     "modeloManual" TEXT,
ADD COLUMN     "nombreClienteManual" TEXT,
ADD COLUMN     "telefonoManual" TEXT,
ALTER COLUMN "casoId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "RQR" ADD CONSTRAINT "RQR_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "Caso"("id") ON DELETE SET NULL ON UPDATE CASCADE;
