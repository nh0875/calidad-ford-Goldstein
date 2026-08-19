-- Quien escribio cada mensaje saliente, cuando lo escribio una persona.
-- Los mensajes ya existentes quedan en NULL: son de antes y su unico
-- rastro esta en AuditLog (ver scripts/windows/quien-mando-el-mensaje.sql).

-- AlterTable
ALTER TABLE "WhatsappMessage" ADD COLUMN     "enviadoPorId" TEXT;

-- CreateIndex
CREATE INDEX "WhatsappMessage_enviadoPorId_idx" ON "WhatsappMessage"("enviadoPorId");

-- AddForeignKey
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_enviadoPorId_fkey" FOREIGN KEY ("enviadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

