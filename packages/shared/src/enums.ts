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
