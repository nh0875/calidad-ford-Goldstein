-- Segundo formato de Excel para las encuestas de fábrica de Volkswagen.
--
-- Hasta ahora la pantalla solo aceptaba el archivo que baja de la plataforma de
-- fábrica (una hoja por sucursal, el vendedor como código de 7 dígitos, el
-- cliente partido en Nombre y Apellido). Ahora entra también el export interno de
-- la concesionaria ("Carga encuestas internas"): una sola hoja, el vendedor por
-- NOMBRE y el cliente completo en una sola columna.

-- De qué archivo salió cada cliente. NO es cosmético, es lo que impide un
-- accidente: al importar, el sistema da por RESPONDIDO a todo pendiente que no
-- venga en el archivo nuevo (si fábrica ya no lo lista, es que contestó). Con dos
-- formatos alimentando la misma lista, una carga del interno cerraría de golpe a
-- todos los que vinieron de fábrica, en silencio. Con esto, cada carga solo puede
-- cerrar a los de su propio origen.
ALTER TABLE "EncuestaFabricaVW" ADD COLUMN IF NOT EXISTS "origenFormato" TEXT NOT NULL DEFAULT 'FABRICA';
CREATE INDEX IF NOT EXISTS "EncuestaFabricaVW_origenFormato_idx" ON "EncuestaFabricaVW"("origenFormato");

-- El archivo interno trae el NOMBRE del vendedor, no su código, y encima cortado
-- a 22 caracteres. Emparejarlo a ojo es jugar a la ruleta con a quién se le avisa,
-- así que se resuelve una vez a mano y queda guardado: es exactamente para lo que
-- ya existe AliasNormalizacion (claveOrigen = el nombre como viene,
-- codigoCanonico = el código de 7 dígitos del vendedor).
ALTER TYPE "TipoAlias" ADD VALUE IF NOT EXISTS 'VENDEDOR_VW';
