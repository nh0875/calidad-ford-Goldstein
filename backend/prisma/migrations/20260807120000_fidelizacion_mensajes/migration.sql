-- Fidelización dentro de Seguimiento: un WhatsappMessage puede pertenecer a un
-- Caso O a un ClienteFidelizacion (antes casoId era obligatorio). Además se
-- marca cuándo el cliente pidió turno con un asesor (3er botón de la plantilla).

-- 1) casoId pasa a ser opcional (los mensajes de fidelización no tienen Caso).
ALTER TABLE "WhatsappMessage" ALTER COLUMN "casoId" DROP NOT NULL;

-- 2) Nueva relación opcional a ClienteFidelizacion.
ALTER TABLE "WhatsappMessage" ADD COLUMN "clienteFidelizacionId" TEXT;

-- 3) Flag: el cliente apretó "Agendar mi Turno con un Asesor".
ALTER TABLE "ClienteFidelizacion" ADD COLUMN "quiereAsesorEn" TIMESTAMP(3);

-- 4) Índice + FK (mismo estilo que Prisma).
CREATE INDEX "WhatsappMessage_clienteFidelizacionId_idx" ON "WhatsappMessage"("clienteFidelizacionId");

ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_clienteFidelizacionId_fkey" FOREIGN KEY ("clienteFidelizacionId") REFERENCES "ClienteFidelizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
