-- Media entrante en los mensajes de WhatsApp (notas de voz, imágenes, etc.).
-- El análisis corre async y separado del webhook, así que el id del archivo en
-- Meta debe persistirse para poder bajarlo después (transcripción de audios).

ALTER TABLE "WhatsappMessage" ADD COLUMN "mediaId" TEXT;
ALTER TABLE "WhatsappMessage" ADD COLUMN "mediaMimeType" TEXT;
ALTER TABLE "WhatsappMessage" ADD COLUMN "mediaTipo" TEXT;
