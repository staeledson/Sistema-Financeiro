import "reflect-metadata";
import { Module } from "@nestjs/common";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { AccountsModule } from "./accounts/accounts.module";
import { CategoriesModule } from "./categories/categories.module";
import { TagsModule } from "./tags/tags.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { BalancesModule } from "./balances/balances.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { IngestModule } from "./ingest/ingest.module";
import { DraftsModule } from "./drafts/drafts.module";
import { ImportModule } from "./import/import.module";
import { CategoryRulesModule } from "./category-rules/category-rules.module";
import { InsightsModule } from "./insights/insights.module";
import { BudgetsModule } from "./budgets/budgets.module";
import { GoalsModule } from "./goals/goals.module";

@Module({
  imports: [
    WorkspacesModule,
    AccountsModule,
    CategoriesModule,
    TagsModule,
    TransactionsModule,
    BalancesModule,
    DashboardModule,
    IngestModule,
    DraftsModule,
    ImportModule,
    CategoryRulesModule,
    InsightsModule,
    BudgetsModule,
    GoalsModule,
  ],
})
export class AppModule {}
