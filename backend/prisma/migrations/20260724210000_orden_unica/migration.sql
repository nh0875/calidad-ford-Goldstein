-- Una orden = un caso. Prohíbe cargar (manual o masivo) un caso cuyo número de
-- orden ya exista en un caso activo.
--
-- NO aplica a:
--   - órdenes vacías ni al placeholder 'S/N' (cargas manuales sin número de
--     orden, o meses del Excel viejo sin columna ORDEN: puede haber varias),
--   - casos dados de baja (la orden de un caso eliminado se puede reutilizar).

-- Defensivo: si hubiera duplicados activos previos (no debería), se conserva el
-- más antiguo y se da de BAJA LÓGICA (recuperable desde Admin) al resto, que es
-- la consecuencia directa de la nueva regla. En una base sin duplicados, este
-- UPDATE no toca ninguna fila.
WITH dups AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "numeroOrden" ORDER BY "createdAt" ASC, id ASC
  ) AS rn
  FROM "Caso"
  WHERE "eliminadoEn" IS NULL AND "numeroOrden" <> 'S/N' AND "numeroOrden" <> ''
)
UPDATE "Caso" c
SET "eliminadoEn" = NOW()
FROM dups
WHERE c.id = dups.id AND dups.rn > 1;

-- Índice único PARCIAL: la garantía dura del "no duplicar órdenes".
CREATE UNIQUE INDEX "Caso_numeroOrden_activo_key"
  ON "Caso"("numeroOrden")
  WHERE "eliminadoEn" IS NULL AND "numeroOrden" <> 'S/N' AND "numeroOrden" <> '';
