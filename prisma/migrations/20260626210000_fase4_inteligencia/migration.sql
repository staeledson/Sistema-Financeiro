-- CreateEnum
CREATE TYPE "RuleMatchType" AS ENUM ('contains', 'equals', 'regex');

-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('spike', 'subscription', 'forecast', 'summary', 'budget_alert', 'goal_alert');

-- CreateEnum
CREATE TYPE "BudgetMethod" AS ENUM ('fixed', 'fifty_thirty_twenty');

-- CreateEnum
CREATE TYPE "CategoryBucket" AS ENUM ('needs', 'wants', 'savings');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN "bucket" "CategoryBucket";

-- CreateTable
CREATE TABLE "category_rules" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "matchType" "RuleMatchType" NOT NULL,
    "pattern" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insights" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "InsightType" NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "method" "BudgetMethod" NOT NULL,
    "categoryId" TEXT,
    "limitCents" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetCents" BIGINT NOT NULL,
    "savedCents" BIGINT NOT NULL DEFAULT 0,
    "deadline" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_contributions" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_rules_workspaceId_priority_idx" ON "category_rules"("workspaceId", "priority" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "category_rules_workspaceId_matchType_pattern_key" ON "category_rules"("workspaceId", "matchType", "pattern");

-- CreateIndex
CREATE INDEX "insights_workspaceId_createdAt_idx" ON "insights"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "insights_workspaceId_type_dedupKey_period_key" ON "insights"("workspaceId", "type", "dedupKey", "period");

-- CreateIndex
CREATE INDEX "budgets_workspaceId_idx" ON "budgets"("workspaceId");

-- CreateIndex
CREATE INDEX "goals_workspaceId_idx" ON "goals"("workspaceId");

-- CreateIndex
CREATE INDEX "goal_contributions_goalId_idx" ON "goal_contributions"("goalId");

-- AddForeignKey
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
