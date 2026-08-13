-- Puntaje de 1 a 5 estrellas para las marcas que miden así (Volkswagen) en vez
-- de por semáforo (Ford). Queda NULL en Ford y en todo lo ya analizado.
--
-- El semáforo y la severidad se siguen guardando: se DERIVAN de las estrellas,
-- para que todo lo que ya funciona por semáforo (avisos, agradecimientos,
-- filtros de Seguimiento, apertura automática de RQR, reportes) siga andando
-- sin cambios. Las estrellas son lo que se MUESTRA y lo que se mide en VW.
ALTER TABLE "SentimentAnalysis" ADD COLUMN "estrellas" INTEGER;
