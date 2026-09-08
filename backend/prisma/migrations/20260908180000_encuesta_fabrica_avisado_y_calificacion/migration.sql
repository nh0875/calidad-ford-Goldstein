-- Encuestas de fábrica: estado AVISADO, calificación y observación.
--
-- Hasta ahora un cliente solo podía estar PENDIENTE o RESPONDIO, y avisarle al
-- vendedor no dejaba ninguna marca en el cliente: la única huella era la fecha
-- del último aviso, guardada en el VENDEDOR. Consecuencia: cada vez que se
-- apretaba "avisar", al vendedor le volvía a llegar la MISMA lista completa,
-- incluidos los clientes que ya le habían avisado la semana pasada.

-- El estado que faltaba en el medio. El aviso a vendedores sale SOLO de los
-- PENDIENTE, así que apenas se avisa el cliente sale de esa bolsa y el próximo
-- mail no lo repite.
ALTER TYPE "EstadoEncuestaFabrica" ADD VALUE IF NOT EXISTS 'AVISADO';

-- Cuándo salió el mail que incluía a este cliente. Va en el CLIENTE y no en el
-- vendedor: es el dato que permite responder "¿a este cliente ya lo avisamos?",
-- que es la pregunta que importa.
ALTER TABLE "EncuestaFabricaVW" ADD COLUMN IF NOT EXISTS "avisadoEn" TIMESTAMP(3);

-- Lo que carga Calidad a mano cuando el cliente contesta. La calificación va de
-- 1 a 5, la misma escala que la encuesta de posventa por WhatsApp, para que un 4
-- signifique lo mismo en todo el sistema.
--
-- Se deja NULL a propósito: se puede marcar RESPONDIDO sin nota. Pasa seguido
-- (el cliente contestó pero nadie anotó cuánto puso, o fábrica todavía no
-- publicó el puntaje) y obligar a inventar un número ensuciaría los promedios
-- con datos falsos.
ALTER TABLE "EncuestaFabricaVW" ADD COLUMN IF NOT EXISTS "calificacion" INTEGER;

-- El comentario que el cliente le hizo a fábrica, o cualquier cosa a tener en
-- cuenta sobre este caso.
ALTER TABLE "EncuestaFabricaVW" ADD COLUMN IF NOT EXISTS "observacionCalidad" TEXT;
