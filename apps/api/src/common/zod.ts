import { z } from "zod";

/** `YYYY-MM-DD` que existe no calendário (rejeita 2026-02-30). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "data inválida");

/** Centavos: inteiro positivo dentro da faixa segura. */
export const centsSchema = z.number().int().positive().safe();
