import { z } from "zod";
import { WORKSPACE_TYPES, MEMBER_ROLES } from "./enums";

export const workspaceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(WORKSPACE_TYPES),
  name: z.string().min(1),
  currency: z.string().length(3).toUpperCase(),
  createdById: z.string().min(1),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceMemberSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(MEMBER_ROLES),
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
