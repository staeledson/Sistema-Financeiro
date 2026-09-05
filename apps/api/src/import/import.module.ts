import { Module } from "@nestjs/common";
import { ImportController } from "./import.controller";
import { ImportService } from "./import.service";
import { StorageModule } from "../storage/storage.module";
import { TransactionsModule } from "../transactions/transactions.module";

@Module({
  imports: [StorageModule, TransactionsModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
