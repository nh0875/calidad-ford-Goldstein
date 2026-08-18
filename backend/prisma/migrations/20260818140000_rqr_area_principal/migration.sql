-- Área PRINCIPAL del RQR de Volkswagen: el sector responsable del reclamo.
--
-- Es distinta de "tipoContacto", que dice por qué TEMA se contactó el cliente.
-- Pueden no coincidir: alguien llama por un tema de posventa y el problema
-- termina siendo de Plan de Ahorro. La subárea cuelga de ESTA, no del tipo de
-- contacto.
--
-- Nullable: en Ford queda vacía (esa marca usa "areaOrigen" en texto libre).
ALTER TABLE "RQR" ADD COLUMN "areaPrincipal" TEXT;
