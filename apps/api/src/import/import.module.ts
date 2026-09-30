import { Module } from "@nestjs/common";
import { ImportController } from "./import.controller";
import { ImportService } from "./import.service";
import { ImportStatementService } from "./import-statement.service";
import { StorageModule } from "../storage/storage.module";
import { TransactionsModule } from "../transactions/transactions.module";

@Module({
  imports: [StorageModule, TransactionsModule],
  controllers: [ImportController],
  providers: [ImportService, ImportStatementService],
})
export class ImportModule {}
