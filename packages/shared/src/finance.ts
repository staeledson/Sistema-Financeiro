import { z } from "zod";
import { ACCOUNT_TYPES, CATEGORY_TYPES, TRANSACTION_TYPES } from "./enums";

export const accountSchema = z.object({
  type: z.enum(ACCOUNT_TYPES),
  name: z.string().min(1),
  openingBalanceCents: z.number().int().default(0),
});

export const categorySchema = z.object({
  type: z.enum(CATEGORY_TYPES),
  name: z.string().min(1),
  parentId: z.string().min(1).nullish(),
  icon: z.string().nullish(),
  color: z.string().nullish(),
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
export type CategoryInput = z.infer<typeof categorySchema>;
export type TransactionInput = z.infer<typeof transactionInputSchema>;
