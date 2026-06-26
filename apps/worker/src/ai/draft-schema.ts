import { z } from "zod";

export const extractedDraftSchema = z.object({
  type: z.enum(["income", "expense", "transfer"]),
  amountCents: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().nullish(),
  counterparty: z.string().nullish(),
  suggestedCategory: z.string().nullish(),
  confidence: z.number().min(0).max(1),
});

export type ExtractedDraft = z.infer<typeof extractedDraftSchema>;

export const DRAFT_JSON_SCHEMA = {
  name: "transaction_draft",
  schema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["income", "expense", "transfer"] },
      amountCents: { type: "integer" },
      date: { type: "string" },
      description: { type: ["string", "null"] },
      counterparty: { type: ["string", "null"] },
      suggestedCategory: { type: ["string", "null"] },
      confidence: { type: "number" },
    },
    required: ["type", "amountCents", "date", "confidence"],
    additionalProperties: false,
  },
} as const;
