import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { IngestController } from "./ingest.controller";
import { IngestService } from "./ingest.service";

@Module({
  imports: [StorageModule],
  controllers: [IngestController],
  providers: [IngestService],
})
export class IngestModule {}
