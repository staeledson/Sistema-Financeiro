import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! });
export const prisma = new PrismaClient({ adapter });
