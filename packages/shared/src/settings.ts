import { z } from "zod";

export const workspaceSettingsSchema = z.object({
  aiConfidenceThreshold: z.number().min(0).max(1),
  aiBatchSize: z.number().int().min(1).max(200),
  transferMatchWindowDays: z.number().int().min(0).max(10),
  ownerNames: z.array(z.string().trim().min(1)).max(20),
});

export const workspaceSettingsUpdateSchema = workspaceSettingsSchema.partial();

export type WorkspaceSettingsInput = z.infer<typeof workspaceSettingsSchema>;

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettingsInput = {
  aiConfidenceThreshold: 0.8,
  aiBatchSize: 40,
  transferMatchWindowDays: 2,
  ownerNames: [],
};
