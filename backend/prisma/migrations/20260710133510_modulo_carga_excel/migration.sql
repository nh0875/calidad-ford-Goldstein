-- AlterTable
ALTER TABLE "ExcelUpload" ADD COLUMN     "kpiResumen" JSONB;

-- AlterTable
ALTER TABLE "SentimentAnalysis" ADD COLUMN     "esHistoricoImportado" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "messageId" DROP NOT NULL;
