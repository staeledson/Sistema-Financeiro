import "reflect-metadata";
import { Module } from "@nestjs/common";
import { WorkspacesModule } from "./workspaces/workspaces.module";

@Module({ imports: [WorkspacesModule] })
export class AppModule {}
