-- Encuestas de fábrica PV (Volkswagen, pedido del 22-09-2026): se suma el estado
-- "Avisado" (se le avisó al cliente y no contestó), que va ANTES del primer
-- contacto. Como AVISADO ya existía, el primer contacto pasa a tener su propio
-- valor; los datos se mueven en la migración siguiente (Postgres no deja usar un
-- valor de enum en la misma transacción en la que se lo agrega).
ALTER TYPE "EstadoEncuestaFabrica" ADD VALUE 'PRIMER_CONTACTO';
