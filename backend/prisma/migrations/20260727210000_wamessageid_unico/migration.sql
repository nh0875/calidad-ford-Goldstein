-- Idempotencia del webhook: el waMessageId de Meta identifica la entrega.
-- Ante un reintento de Meta (reenvía la misma notificación), un índice único
-- impide duplicar el mensaje entrante y volver a disparar el análisis.

-- 1) Dedup defensivo: si por reintentos previos hubiera filas repetidas con el
--    mismo waMessageId, se conserva la más antigua y se borran las demás.
DELETE FROM "WhatsappMessage" a
USING "WhatsappMessage" b
WHERE a."waMessageId" IS NOT NULL
  AND a."waMessageId" = b."waMessageId"
  AND (a."createdAt" > b."createdAt"
       OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

-- 2) Reemplazar el índice simple por uno único. En Postgres los NULL son
--    distintos entre sí, así que los mensajes salientes sin waMessageId no
--    colisionan.
DROP INDEX IF EXISTS "WhatsappMessage_waMessageId_idx";
CREATE UNIQUE INDEX "WhatsappMessage_waMessageId_key" ON "WhatsappMessage"("waMessageId");
