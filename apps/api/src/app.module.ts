import "reflect-metadata";
import { Module } from "@nestjs/common";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { AccountsModule } from "./accounts/accounts.module";
import { CategoriesModule } from "./categories/categories.module";
import { TagsModule } from "./tags/tags.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { BalancesModule } from "./balances/balances.module";
import { DashboardModule } from "./dashboard/dashboard.module";

@Module({
  imports: [
    WorkspacesModule,
    AccountsModule,
    CategoriesModule,
    TagsModule,
    TransactionsModule,
    BalancesModule,
    DashboardModule,
  ],
})
export class AppModule {}
