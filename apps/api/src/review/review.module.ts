import { Module } from "@nestjs/common";
import { CategoryRulesModule } from "../category-rules/category-rules.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { ReviewController } from "./review.controller";
import { ReviewService } from "./review.service";

@Module({
  imports: [TransactionsModule, CategoryRulesModule],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}
