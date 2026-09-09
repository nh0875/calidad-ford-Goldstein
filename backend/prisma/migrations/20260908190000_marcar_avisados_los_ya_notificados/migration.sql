-- Los clientes que ya se avisaron, marcados como tales.
--
-- El estado AVISADO se agregó recién, así que TODOS los clientes que ya están en
-- el sistema quedaron en PENDIENTE aunque a su vendedor ya se le haya mandado el
-- correo con ellos adentro. Sin esta corrección, el primer aviso después de
-- actualizar les volvería a mandar la lista entera: justo lo que el estado nuevo
-- vino a evitar.

-- SOLO los de vendedores a los que REALMENTE se les avisó alguna vez.
--
-- La tentación era marcar todo lo pendiente de una, pero eso enterraría a los
-- clientes de los vendedores que NUNCA recibieron nada -- típicamente los que no
-- tienen el correo cargado. Esos clientes quedarían como avisados sin que nadie
-- los haya visto jamás, saldrían del próximo correo y no habría forma de darse
-- cuenta. Es la peor falla posible en esta pantalla, así que se prefiere quedarse
-- corto: si alguno queda en PENDIENTE de más, lo peor que pasa es que se avise
-- una vez de más.
--
-- La fecha se copia del vendedor en vez de poner "ahora": es la fecha en que el
-- correo salió de verdad, y sirve para saber cuánto hace que ese cliente está
-- esperando.
UPDATE "EncuestaFabricaVW" AS e
SET "estado" = 'AVISADO',
    "avisadoEn" = v."ultimoAvisoEn"
FROM "VendedorVW" AS v
WHERE e."vendedorId" = v."id"
  AND e."estado" = 'PENDIENTE'
  AND v."ultimoAvisoEn" IS NOT NULL;
