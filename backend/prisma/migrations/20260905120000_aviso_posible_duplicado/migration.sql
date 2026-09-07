-- Aviso nuevo: POSIBLE_DUPLICADO.
--
-- Pasa seguido en la agencia: el mismo auto (mismo chasis o misma patente) y el
-- mismo cliente entran DOS VECES con numeros de orden distintos. Como la orden
-- es la clave unica, para el sistema son dos casos legitimos y los dos salen a
-- contactar: el cliente termina recibiendo dos encuestas por lo mismo.
--
-- No se puede resolver solo (a veces son dos visitas de verdad, a veces es un
-- error de carga), asi que el sistema avisa y lo decide una persona. El aviso lo
-- ve el ADMIN y todos los usuarios del area del caso, que es como funcionan los
-- avisos que ya existen.
--
-- ALTER TYPE ... ADD VALUE es aditivo: no toca ningun aviso existente.
ALTER TYPE "TipoAviso" ADD VALUE IF NOT EXISTS 'POSIBLE_DUPLICADO';

-- Provincia del caso que originó el aviso.
--
-- Hasta ahora los avisos se filtraban SOLO por area, asi que un usuario de
-- Mendoza veia el cartel de un caso de San Juan. Con la separacion por provincia
-- aplicada en todo el sistema, los avisos tienen que acompañar: se guarda la
-- sucursal del caso y se filtra igual que los listados.
--
-- Queda NULL en los avisos viejos, y un aviso sin provincia lo ve todo el mundo
-- (no hay contra que compararlo). Es lo mismo que se hace con los RQR manuales.
ALTER TABLE "Aviso" ADD COLUMN IF NOT EXISTS "sucursal" TEXT;
CREATE INDEX IF NOT EXISTS "Aviso_sucursal_idx" ON "Aviso"("sucursal");
