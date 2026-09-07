-- Segundo contacto + llamada pendiente (Volkswagen).
--
-- Circuito nuevo: si el cliente no contesta el primer contacto a las 24 h, sale
-- solo un "segundo_contacto"; si tampoco contesta ese a las 24 h, el caso queda
-- para que lo llame la encargada de Calidad, que carga a mano lo que le diga.

-- Dos estados nuevos.
--  LLAMADA_PENDIENTE : no contestó ninguno de los dos WhatsApp, hay que llamarlo.
--  RESPONDIO_LLAMADA : contestó, pero por teléfono. Se mide aparte a propósito,
--                      para poder saber cuántos se rescatan llamando.
ALTER TYPE "EstadoContacto" ADD VALUE IF NOT EXISTS 'LLAMADA_PENDIENTE';
ALTER TYPE "EstadoContacto" ADD VALUE IF NOT EXISTS 'RESPONDIO_LLAMADA';

-- Cuándo salió el segundo contacto. Sirve para dos cosas: para no mandarlo dos
-- veces, y para contar las 24 h que faltan hasta pasarlo a llamada pendiente.
-- No alcanza con mirar el último mensaje saliente: podría ser cualquier otro.
ALTER TABLE "Caso" ADD COLUMN IF NOT EXISTS "segundoContactoEn" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Caso_segundoContactoEn_idx" ON "Caso"("segundoContactoEn");

-- Por qué no se pudo cerrar por teléfono (no atendió, número equivocado, no quiso
-- contestar). Queda escrito: si no, un caso cerrado como "no respondió" no se
-- distingue del que nunca se intentó llamar.
ALTER TABLE "Caso" ADD COLUMN IF NOT EXISTS "llamadaMotivo" TEXT;

-- El análisis que sale de una llamada no lo generó la IA: lo cargó una persona.
-- Se marca igual que ya se marcan los importados del Excel histórico.
ALTER TABLE "SentimentAnalysis" ADD COLUMN IF NOT EXISTS "esLlamada" BOOLEAN NOT NULL DEFAULT false;
