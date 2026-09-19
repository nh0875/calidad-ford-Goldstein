-- Indicadores CEM de POSVENTA con las columnas de su planilla (Volkswagen,
-- "Postventa Q 2026", pedido del 19-09-2026): mails enviados, las notas Q1 a Q4 por
-- mes y por trimestre, y la tabla de escalas LVS en los objetivos. Solo columnas
-- nuevas y vacías: nada de lo cargado cambia.
ALTER TABLE "IndicadorCemMes" ADD COLUMN "mailsEnviados" INTEGER;
ALTER TABLE "IndicadorCemMes" ADD COLUMN "notaTrato" DOUBLE PRECISION;
ALTER TABLE "IndicadorCemMes" ADD COLUMN "notaOrganizacion" DOUBLE PRECISION;
ALTER TABLE "IndicadorCemMes" ADD COLUMN "notaCalidadReparacion" DOUBLE PRECISION;
ALTER TABLE "IndicadorCemMes" ADD COLUMN "notaLvs" DOUBLE PRECISION;

ALTER TABLE "IndicadorCemTrimestre" ADD COLUMN "notaTrato" DOUBLE PRECISION;
ALTER TABLE "IndicadorCemTrimestre" ADD COLUMN "notaOrganizacion" DOUBLE PRECISION;
ALTER TABLE "IndicadorCemTrimestre" ADD COLUMN "notaCalidadReparacion" DOUBLE PRECISION;
ALTER TABLE "IndicadorCemTrimestre" ADD COLUMN "notaLvs" DOUBLE PRECISION;

ALTER TABLE "ObjetivoCemTrimestre" ADD COLUMN "lvsEscala1" DOUBLE PRECISION;
ALTER TABLE "ObjetivoCemTrimestre" ADD COLUMN "lvsEscala2" DOUBLE PRECISION;
ALTER TABLE "ObjetivoCemTrimestre" ADD COLUMN "lvsEscala3" DOUBLE PRECISION;
ALTER TABLE "ObjetivoCemTrimestre" ADD COLUMN "lvsEscala4" DOUBLE PRECISION;
