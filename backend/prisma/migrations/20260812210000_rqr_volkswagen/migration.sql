-- Campos del RQR de Volkswagen. Todos NULLABLE: el mismo modelo sirve a las dos
-- marcas y en Ford quedan vacíos. El formulario los pide (y el controller los
-- exige) solo cuando la marca los usa.

-- Clasificación del reclamo. OJO: "tipoContacto" NO reemplaza a "area".
-- "area" (VENTAS/POSVENTA) es lo que gobierna quién puede ver el RQR y se sigue
-- usando para eso; "tipoContacto" es el dato de negocio de VW y suma
-- PLAN_DE_AHORRO, que no existe como área de usuario.
ALTER TABLE "RQR" ADD COLUMN "tipoContacto" TEXT;
ALTER TABLE "RQR" ADD COLUMN "subarea" TEXT;
ALTER TABLE "RQR" ADD COLUMN "origenRqr" TEXT;

-- Datos del concesionario donde ocurrió el hecho.
ALTER TABLE "RQR" ADD COLUMN "codigoSucursal" TEXT;
ALTER TABLE "RQR" ADD COLUMN "razonSocial" TEXT;

-- El tratamiento puede quedar a cargo de hasta dos personas.
ALTER TABLE "RQR" ADD COLUMN "tratamientoDadoPor2" TEXT;

-- Quién cargó el RQR (se imprime en el documento; distinto de la auditoría).
ALTER TABLE "RQR" ADD COLUMN "creadoPorId" TEXT;

ALTER TABLE "RQR"
  ADD CONSTRAINT "RQR_creadoPorId_fkey"
  FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
