-- Fidelización desde la planilla de VENTAS de la agencia, además del export de
-- turnos de Ford que ya se cargaba. Son dos circuitos con reglas distintas:
-- el de turnos trae el service (solo 1° a 5°), el de ventas NO trae ningún dato
-- de service, así que esas columnas pasan a ser opcionales.

-- 1) De qué planilla salió cada destinatario. Todo lo ya cargado es del export
--    de turnos, así que el default TURNOS deja los datos existentes correctos.
CREATE TYPE "OrigenFidelizacion" AS ENUM ('TURNOS', 'VENTAS');

ALTER TABLE "ClienteFidelizacion"
  ADD COLUMN "origen" "OrigenFidelizacion" NOT NULL DEFAULT 'TURNOS';

-- 2) Los destinatarios de la planilla de ventas no tienen service ni comentario
--    del asesor: las dos columnas dejan de ser obligatorias.
ALTER TABLE "ClienteFidelizacion" ALTER COLUMN "numeroServicio" DROP NOT NULL;
ALTER TABLE "ClienteFidelizacion" ALTER COLUMN "comentarioAsesor" DROP NOT NULL;

-- 3) Fecha de entrega del vehículo (solo VENTAS): único dato temporal de esa
--    planilla, sirve para ordenar el detalle y para saber a quién se contactó.
ALTER TABLE "ClienteFidelizacion" ADD COLUMN "fechaEntrega" TIMESTAMP(3);
