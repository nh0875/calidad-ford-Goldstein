-- Lo que en Encuestas de fábrica PV se venía mostrando como "Primer contacto"
-- estaba guardado en AVISADO: pasa al valor nuevo, para que AVISADO quede libre
-- para el estado nuevo "Avisado". Las encuestas de Ventas NO se tocan: ahí
-- AVISADO sigue siendo "se le avisó al vendedor".
UPDATE "EncuestaFabricaPV" SET estado = 'PRIMER_CONTACTO' WHERE estado = 'AVISADO';
