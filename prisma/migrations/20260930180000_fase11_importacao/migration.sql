-- AlterEnum
ALTER TYPE "ImportFormat" ADD VALUE 'pdf_statement';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "postedDate" DATE;

-- AlterTable
ALTER TABLE "import_batches" ADD COLUMN     "balanceCheck" JSONB,
ADD COLUMN     "detectedAccountRef" TEXT,
ADD COLUMN     "institution" "Institution",
ADD COLUMN     "undoneAt" TIMESTAMP(3);
