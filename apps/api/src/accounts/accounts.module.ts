import { Module } from "@nestjs/common";
import { BalancesModule } from "../balances/balances.module";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";

@Module({ imports: [BalancesModule], controllers: [AccountsController], providers: [AccountsService], exports: [AccountsService] })
export class AccountsModule {}
