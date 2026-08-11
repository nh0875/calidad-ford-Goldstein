-- ABM de destinatarios de Fidelización: edición y borrado lógico, para la
-- pantalla nueva "Clientes de fidelización". (El valor MANUAL del enum se agrega
-- en la migración anterior, que va sola por el requisito de Postgres.)

-- 1) Borrado lógico (solo ADMIN), igual que en Caso/RQR/ExcelUpload: nunca se
--    borra físicamente y los listados excluyen las filas con eliminadoEn.
ALTER TABLE "ClienteFidelizacion" ADD COLUMN "eliminadoEn" TIMESTAMP(3);
ALTER TABLE "ClienteFidelizacion" ADD COLUMN "eliminadoPorId" TEXT;

ALTER TABLE "ClienteFidelizacion"
  ADD CONSTRAINT "ClienteFidelizacion_eliminadoPorId_fkey"
  FOREIGN KEY ("eliminadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) Fecha de última modificación (la edición desde la pantalla la actualiza).
--    Las filas existentes arrancan con la fecha de creación.
ALTER TABLE "ClienteFidelizacion" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "ClienteFidelizacion" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "ClienteFidelizacion" ALTER COLUMN "updatedAt" SET NOT NULL;

-- 3) Índices para el listado global (filtro por origen y por no-eliminados).
CREATE INDEX "ClienteFidelizacion_origen_idx" ON "ClienteFidelizacion"("origen");
CREATE INDEX "ClienteFidelizacion_eliminadoEn_idx" ON "ClienteFidelizacion"("eliminadoEn");
