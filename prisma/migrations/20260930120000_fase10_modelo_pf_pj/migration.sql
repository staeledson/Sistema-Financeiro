-- CreateEnum
CREATE TYPE "AccountEntity" AS ENUM ('pf', 'pj');

-- CreateEnum
CREATE TYPE "Institution" AS ENUM ('bb', 'inter', 'mercado_pago', 'c6', 'other');

-- CreateEnum
CREATE TYPE "CategoryEntity" AS ENUM ('pf', 'pj', 'both');

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "closingDay" INTEGER,
ADD COLUMN     "creditLimitCents" BIGINT,
ADD COLUMN     "dueDay" INTEGER,
ADD COLUMN     "entity" "AccountEntity" NOT NULL DEFAULT 'pf',
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "institution" "Institution" NOT NULL DEFAULT 'other';

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "entity" "CategoryEntity" NOT NULL DEFAULT 'both';

-- CreateTable
CREATE TABLE "workspace_settings" (
    "workspaceId" TEXT NOT NULL,
    "aiConfidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "aiBatchSize" INTEGER NOT NULL DEFAULT 40,
    "transferMatchWindowDays" INTEGER NOT NULL DEFAULT 2,
    "ownerNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_settings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE INDEX "bank_accounts_workspaceId_entity_idx" ON "bank_accounts"("workspaceId", "entity");

-- AddForeignKey
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dados: categorias PJ de fábrica para os workspaces que já existem
INSERT INTO "categories" ("id", "workspaceId", "type", "name", "isSystem", "entity")
SELECT
  'c' || md5(w."id" || '|' || v."name"),
  w."id",
  v."type"::"CategoryType",
  v."name",
  true,
  'pj'::"CategoryEntity"
FROM "workspaces" w
CROSS JOIN (VALUES
  ('income',  'Receita de serviços'),
  ('expense', 'Pró-labore'),
  ('expense', 'Impostos e tributos'),
  ('expense', 'Fornecedores'),
  ('expense', 'Serviços contratados'),
  ('expense', 'Tarifas bancárias'),
  ('expense', 'Folha e terceiros')
) AS v("type", "name");
