-- Tres cosas que pidió Calidad de Volkswagen.

-- 1. BORRAR USUARIOS.
--
-- Es borrado LÓGICO, no físico, y no por comodidad: un Usuario cuelga de once
-- relaciones (auditoría, RQR que creó, casos que borró, mensajes de WhatsApp que
-- envió...). Un DELETE de verdad o falla por clave foránea, o se lleva puesta la
-- trazabilidad de un sistema de Calidad, que es justamente lo que no se puede
-- perder. Con esto el usuario desaparece de la pantalla y no puede entrar, y la
-- historia queda intacta.
ALTER TABLE "Usuario" ADD COLUMN IF NOT EXISTS "eliminadoEn" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Usuario_eliminadoEn_idx" ON "Usuario"("eliminadoEn");

-- 2. ENCUESTAS DE FÁBRICA CARGADAS A MANO.
--
-- Hasta ahora una encuesta pendiente solo podía nacer de un Excel de fábrica, así
-- que el origen era obligatorio. Para poder cargar un caso suelto, el origen pasa
-- a ser opcional.
ALTER TABLE "EncuestaFabricaVW" ALTER COLUMN "origenUploadId" DROP NOT NULL;

-- Y hace falta marcarlas, por un motivo que no se ve a simple vista: al importar,
-- todo pendiente que NO venga en el archivo nuevo se da por respondido (si el
-- cliente ya no está en la lista de fábrica, es que contestó). Un caso cargado a
-- mano nunca va a venir en ese archivo, así que sin esta marca desaparecería solo
-- en la siguiente carga: el cliente saldría de la lista de su vendedor, nadie lo
-- llamaría, y la tasa de respuesta subiría por alguien que nunca contestó.
ALTER TABLE "EncuestaFabricaVW" ADD COLUMN IF NOT EXISTS "esManual" BOOLEAN NOT NULL DEFAULT false;
