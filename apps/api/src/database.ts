import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// BigInt fields (amountCents, openingBalanceCents) cannot be serialized by JSON.stringify.
// This polyfill converts them to numbers for HTTP responses.
// Safe for financial values in this app (< Number.MAX_SAFE_INTEGER = 9007199254740991 cents ≈ 90 trillion).
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! });
export const prisma = new PrismaClient({ adapter });
