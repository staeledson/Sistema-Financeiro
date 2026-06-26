-- CreateEnum
CREATE TYPE "ImportFormat" AS ENUM ('csv', 'ofx', 'pdf');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('preview', 'committed', 'failed');

-- AlterEnum
ALTER TYPE "AiJobKind" ADD VALUE 'parse_invoice';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "importBatchId" TEXT,
ADD COLUMN "importFingerprint" TEXT;

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT,
    "format" "ImportFormat" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'preview',
    "fileRef" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "dupCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_mappings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" "ImportFormat" NOT NULL,
    "mapping" JSONB NOT NULL,

    CONSTRAINT "import_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_workspaceId_idx" ON "import_batches"("workspaceId");

-- CreateIndex
CREATE INDEX "import_mappings_workspaceId_idx" ON "import_mappings"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "import_mappings_workspaceId_name_key" ON "import_mappings"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_workspaceId_importFingerprint_key" ON "transactions"("workspaceId", "importFingerprint");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
