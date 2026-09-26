-- El teléfono del cliente en la encuesta de fábrica (Volkswagen, pedido del
-- 25-09-2026): el aviso al vendedor lo lleva, así puede llamarlo. No viene en el
-- Excel de fábrica; se busca en los casos de Contacto por el dominio.
ALTER TABLE "EncuestaFabricaVW" ADD COLUMN "telefono" TEXT;
