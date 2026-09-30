import { z } from "zod";
import {
  ACCOUNT_ENTITIES,
  ACCOUNT_TYPES,
  CATEGORY_ENTITIES,
  CATEGORY_TYPES,
  INSTITUTIONS,
  TRANSACTION_TYPES,
} from "./enums";

/** Campos que só fazem sentido em cartão de crédito. */
export const CARD_ONLY_FIELDS = ["closingDay", "dueDay", "creditLimitCents"] as const;

const cardFieldShape = {
  closingDay: z.number().int().min(1).max(31).nullish(),
  dueDay: z.number().int().min(1).max(31).nullish(),
  creditLimitCents: z.number().int().nonnegative().nullish(),
};

export function cardFieldsPresent(
  dto: Partial<Record<(typeof CARD_ONLY_FIELDS)[number], number | null | undefined>>,
): boolean {
  return CARD_ONLY_FIELDS.some((k) => dto[k] != null);
}

export const accountSchema = z
  .object({
    type: z.enum(ACCOUNT_TYPES),
    name: z.string().min(1),
    openingBalanceCents: z.number().int().default(0),
    entity: z.enum(ACCOUNT_ENTITIES).default("pf"),
    institution: z.enum(INSTITUTIONS).default("other"),
    externalId: z.string().min(1).nullish(),
    ...cardFieldShape,
  })
  .superRefine((v, ctx) => {
    if (v.type !== "credit_card" && cardFieldsPresent(v))
      ctx.addIssue({ code: "custom", message: "closingDay, dueDay e creditLimitCents só valem para cartão de crédito" });
  });

export const accountUpdateSchema = z
  .object({
    name: z.string().min(1),
    entity: z.enum(ACCOUNT_ENTITIES),
    institution: z.enum(INSTITUTIONS),
    externalId: z.string().min(1).nullable(),
    ...cardFieldShape,
  })
  .partial();

export const categorySchema = z.object({
  type: z.enum(CATEGORY_TYPES),
  name: z.string().min(1),
  parentId: z.string().min(1).nullish(),
  icon: z.string().nullish(),
  color: z.string().nullish(),
  entity: z.enum(CATEGORY_ENTITIES).default("both"),
});

export const transactionInputSchema = z
  .object({
    type: z.enum(TRANSACTION_TYPES),
    amountCents: z.number().int().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    accountId: z.string().min(1).nullish(),
    sourceAccountId: z.string().min(1).nullish(),
    destAccountId: z.string().min(1).nullish(),
    categoryId: z.string().min(1).nullish(),
    description: z.string().nullish(),
    counterparty: z.string().nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "transfer") {
      if (!v.sourceAccountId || !v.destAccountId)
        ctx.addIssue({ code: "custom", message: "transfer requer origem e destino" });
      if (v.sourceAccountId && v.sourceAccountId === v.destAccountId)
        ctx.addIssue({ code: "custom", message: "origem e destino devem diferir" });
      if (v.categoryId)
        ctx.addIssue({ code: "custom", message: "transfer não tem categoria" });
      if (v.accountId)
        ctx.addIssue({ code: "custom", message: "transfer usa origem/destino" });
    } else {
      if (!v.accountId)
        ctx.addIssue({ code: "custom", message: "income/expense requer conta" });
      if (v.sourceAccountId || v.destAccountId)
        ctx.addIssue({ code: "custom", message: "income/expense não usa origem/destino" });
    }
  });

export type AccountInput = z.infer<typeof accountSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type TransactionInput = z.infer<typeof transactionInputSchema>;
