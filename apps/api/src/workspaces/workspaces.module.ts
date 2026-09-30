import { Module } from "@nestjs/common";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";
import { WorkspaceSettingsController } from "./workspace-settings.controller";
import { WorkspaceSettingsService } from "./workspace-settings.service";

@Module({
  controllers: [WorkspacesController, WorkspaceSettingsController],
  providers: [WorkspacesService, WorkspaceSettingsService],
  exports: [WorkspaceSettingsService],
})
export class WorkspacesModule {}
