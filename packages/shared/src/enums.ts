export const WORKSPACE_TYPES = ["personal", "family", "business"] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ACCOUNT_TYPES = ["checking", "savings", "credit_card", "cash", "investment"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CATEGORY_TYPES = ["income", "expense"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const TRANSACTION_TYPES = ["income", "expense", "transfer"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const ACCOUNT_ENTITIES = ["pf", "pj"] as const;
export type AccountEntity = (typeof ACCOUNT_ENTITIES)[number];

export const INSTITUTIONS = ["bb", "inter", "mercado_pago", "c6", "other"] as const;
export type Institution = (typeof INSTITUTIONS)[number];

export const CATEGORY_ENTITIES = ["pf", "pj", "both"] as const;
export type CategoryEntity = (typeof CATEGORY_ENTITIES)[number];
