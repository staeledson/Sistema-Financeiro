-- CreateEnum
CREATE TYPE "CategorySource" AS ENUM ('manual', 'rule', 'ai', 'import', 'none');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('ok', 'pending');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "categoryConfidence" DOUBLE PRECISION,
ADD COLUMN     "categorySource" "CategorySource" NOT NULL DEFAULT 'none',
ADD COLUMN     "ignored" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'ok',
ADD COLUMN     "suggestedCategoryId" TEXT,
ADD COLUMN     "transferPairId" TEXT;

-- AlterTable
ALTER TABLE "category_rules" ADD COLUMN     "hitCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "transactions_workspaceId_reviewStatus_idx" ON "transactions"("workspaceId", "reviewStatus");

-- CreateIndex
CREATE INDEX "transactions_transferPairId_idx" ON "transactions"("transferPairId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_suggestedCategoryId_fkey" FOREIGN KEY ("suggestedCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Dados: transações que já tinham categoria passam a constar como categorizadas manualmente
UPDATE "transactions" SET "categorySource" = 'manual' WHERE "categoryId" IS NOT NULL;
