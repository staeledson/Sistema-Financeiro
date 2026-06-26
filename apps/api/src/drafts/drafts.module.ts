import { Module } from "@nestjs/common";
import { TransactionsModule } from "../transactions/transactions.module";
import { DraftsController } from "./drafts.controller";
import { DraftsService } from "./drafts.service";

@Module({
  imports: [TransactionsModule],
  controllers: [DraftsController],
  providers: [DraftsService],
})
export class DraftsModule {}
