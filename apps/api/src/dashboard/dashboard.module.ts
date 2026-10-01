import { Module } from "@nestjs/common";
import { BalancesModule } from "../balances/balances.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { SpendingService } from "./spending.service";
import { CardsService } from "./cards.service";

@Module({
  imports: [BalancesModule],
  controllers: [DashboardController],
  providers: [DashboardService, SpendingService, CardsService],
  exports: [CardsService],
})
export class DashboardModule {}
