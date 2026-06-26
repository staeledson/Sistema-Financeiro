import { Module } from "@nestjs/common";
import { ImportController } from "./import.controller";
import { ImportService } from "./import.service";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [StorageModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
