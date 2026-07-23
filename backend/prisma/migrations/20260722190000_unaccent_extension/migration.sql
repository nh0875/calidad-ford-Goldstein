-- Habilita búsqueda insensible a acentos (tildes) para el autocompletado de
-- casos: unaccent("Gómez") = "Gomez". La usa caso.controller.ts (buscarCasos).
-- La extensión viene incluida en la imagen oficial de PostgreSQL (contrib).
CREATE EXTENSION IF NOT EXISTS unaccent;
