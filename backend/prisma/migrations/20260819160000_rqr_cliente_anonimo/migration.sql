-- El cliente del RQR no quiso identificarse (distinto de: no cargaron el nombre).

-- AlterTable
ALTER TABLE "RQR" ADD COLUMN     "clienteAnonimo" BOOLEAN NOT NULL DEFAULT false;

