-- Provincia/sucursal que atiende cada usuario (ej. "San Juan", "Mendoza").
-- NULL = todas (sin restricción de provincia). Se usa para repartir los
-- refuerzos Ford por provincia además de por área.
ALTER TABLE "Usuario" ADD COLUMN "sucursal" TEXT;
