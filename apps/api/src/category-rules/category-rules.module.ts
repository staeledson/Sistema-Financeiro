import { Module } from "@nestjs/common";
import { CategoryRulesController } from "./category-rules.controller";
import { CategoryRulesService } from "./category-rules.service";

@Module({
  controllers: [CategoryRulesController],
  providers: [CategoryRulesService],
  exports: [CategoryRulesService],
})
export class CategoryRulesModule {}
