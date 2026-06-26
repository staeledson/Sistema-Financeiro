export const WORKSPACE_TYPES = ["personal", "family", "business"] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
