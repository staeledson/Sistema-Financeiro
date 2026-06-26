import { Module } from "@nestjs/common";
import { MailGateway } from "./mail.gateway";

@Module({
  providers: [MailGateway],
  exports: [MailGateway],
})
export class MailModule {}
