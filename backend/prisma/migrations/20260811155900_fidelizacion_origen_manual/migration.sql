-- Alta MANUAL de destinatarios de Fidelización: el cliente suelto que no vino en
-- ninguna planilla y lo carga alguien de Calidad desde la pantalla.
--
-- Va SOLO en esta migración a propósito: Postgres no deja usar un valor nuevo de
-- enum en la misma transacción en que se agrega, así que el ALTER TYPE tiene que
-- quedar commiteado antes de que cualquier otra sentencia lo referencie.
ALTER TYPE "OrigenFidelizacion" ADD VALUE IF NOT EXISTS 'MANUAL';
