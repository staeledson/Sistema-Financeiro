import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { SpendingService } from "./spending.service";

@Module({ controllers: [DashboardController], providers: [DashboardService, SpendingService] })
export class DashboardModule {}
