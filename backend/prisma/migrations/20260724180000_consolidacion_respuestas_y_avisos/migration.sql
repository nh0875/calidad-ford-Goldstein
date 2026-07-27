-- Consolidación de respuestas del cliente + avisos en pantalla
--
-- Problema que resuelve: un cliente que contesta con varios mensajes seguidos
-- generaba UN análisis por mensaje. Eso multiplicaba las llamadas a la IA,
-- inflaba las estadísticas (cada fragmento contaba como una respuesta más en el
-- reporte de sentimiento y en el ranking de asesores) y dejaba que un "gracias"
-- posterior tapara una queja, porque las pantallas muestran el último análisis.

-- 1) Marca de "este mensaje entrante ya fue analizado". Varios mensajes pueden
--    compartir un único análisis (se consolidan en una sola llamada a la IA).
ALTER TABLE "WhatsappMessage" ADD COLUMN "analizadoEn" TIMESTAMP(3);

-- Backfill: todos los mensajes entrantes que ya existen fueron procesados con
-- el esquema viejo (uno por uno). Se marcan como analizados para que el worker
-- nuevo no los vuelva a levantar y re-analice todo el historial.
UPDATE "WhatsappMessage" SET "analizadoEn" = "createdAt" WHERE "direction" = 'ENTRANTE';

-- 2) Un caso tiene UN análisis que cuenta. Los posteriores son seguimiento.
ALTER TABLE "SentimentAnalysis" ADD COLUMN "esSeguimiento" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SentimentAnalysis" ADD COLUMN "mensajesAnalizados" INTEGER NOT NULL DEFAULT 1;

-- Backfill: si un caso ya tiene varios análisis (el esquema viejo permitía uno
-- por mensaje), se conserva como principal el MÁS GRAVE, y a igual gravedad el
-- más reciente. Los demás pasan a seguimiento. Así las estadísticas dejan de
-- contar dos veces al mismo cliente y no se pierde ninguna queja: el peor manda.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "casoId"
      ORDER BY
        CASE "semaforo" WHEN 'ROJO' THEN 3 WHEN 'AMARILLO' THEN 2 WHEN 'VERDE' THEN 1 ELSE 0 END DESC,
        "analyzedAt" DESC
    ) AS pos
  FROM "SentimentAnalysis"
)
UPDATE "SentimentAnalysis" s
SET "esSeguimiento" = true
FROM ranked r
WHERE s."id" = r."id" AND r.pos > 1;

CREATE INDEX "SentimentAnalysis_casoId_esSeguimiento_idx" ON "SentimentAnalysis"("casoId", "esSeguimiento");

-- 3) Avisos en pantalla (reemplazan a la notificación por mail)
CREATE TYPE "TipoAviso" AS ENUM ('RQR_ABIERTO', 'ESCALADO', 'AMARILLO_SIN_RQR');

CREATE TABLE "Aviso" (
    "id" TEXT NOT NULL,
    "tipo" "TipoAviso" NOT NULL,
    "area" "AreaTrabajo" NOT NULL DEFAULT 'POSVENTA',
    "casoId" TEXT,
    "rqrId" TEXT,
    "titulo" TEXT NOT NULL,
    "detalle" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vistoEn" TIMESTAMP(3),
    "vistoPorId" TEXT,

    CONSTRAINT "Aviso_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Aviso_area_vistoEn_idx" ON "Aviso"("area", "vistoEn");
CREATE INDEX "Aviso_casoId_idx" ON "Aviso"("casoId");
CREATE INDEX "Aviso_rqrId_idx" ON "Aviso"("rqrId");

ALTER TABLE "Aviso" ADD CONSTRAINT "Aviso_casoId_fkey" FOREIGN KEY ("casoId") REFERENCES "Caso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Aviso" ADD CONSTRAINT "Aviso_rqrId_fkey" FOREIGN KEY ("rqrId") REFERENCES "RQR"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Aviso" ADD CONSTRAINT "Aviso_vistoPorId_fkey" FOREIGN KEY ("vistoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
