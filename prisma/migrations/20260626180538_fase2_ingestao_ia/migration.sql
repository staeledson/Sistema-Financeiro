-- CreateEnum
CREATE TYPE "AiJobKind" AS ENUM ('parse_text', 'parse_image', 'parse_audio');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('queued', 'processing', 'done', 'failed');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('draft', 'discarded');

-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "AiJobKind" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'queued',
    "inputRef" TEXT,
    "result" JSONB,
    "error" TEXT,
    "costTokens" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_drafts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "aiJobId" TEXT,
    "kind" "AiJobKind" NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'draft',
    "type" "TransactionType",
    "amountCents" BIGINT,
    "date" DATE,
    "description" TEXT,
    "counterparty" TEXT,
    "suggestedCategory" TEXT,
    "categoryId" TEXT,
    "accountId" TEXT,
    "confidence" DOUBLE PRECISION,
    "sourceRef" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_jobs_workspaceId_idx" ON "ai_jobs"("workspaceId");

-- CreateIndex
CREATE INDEX "transaction_drafts_workspaceId_status_idx" ON "transaction_drafts"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_drafts" ADD CONSTRAINT "transaction_drafts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_drafts" ADD CONSTRAINT "transaction_drafts_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "ai_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_drafts" ADD CONSTRAINT "transaction_drafts_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_drafts" ADD CONSTRAINT "transaction_drafts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_drafts" ADD CONSTRAINT "transaction_drafts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
