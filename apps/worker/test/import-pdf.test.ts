import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pdf-parse before importing processor
vi.mock("pdf-parse", () => ({
  default: async (_buf: Buffer) => ({ text: "Compra Netflix 15/06/2026 R$ 55,90\nCompra Uber 20/06/2026 R$ 12,40" }),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Mock prisma
const createdDrafts: unknown[] = [];
vi.mock("../src/database", () => ({
  prisma: {
    category: {
      findMany: vi.fn().mockResolvedValue([{ id: "cat1", name: "Assinaturas", type: "expense" }]),
    },
    transactionDraft: {
      create: vi.fn().mockImplementation((args: { data: unknown }) => {
        createdDrafts.push(args.data);
        return Promise.resolve({ id: "draft-1" });
      }),
    },
    aiJob: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

// Mock S3
vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: vi.fn(),
  S3Client: vi.fn(),
}));

import { processPdfInvoice } from "../src/import/pdf.processor";
import { OpenRouterGateway } from "../src/ai/openrouter";

beforeEach(() => {
  createdDrafts.length = 0;
  fetchMock.mockReset();
});

describe("processPdfInvoice", () => {
  it("extrai múltiplas linhas do PDF e cria N drafts", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                transactions: [
                  { type: "expense", amountCents: 5590, date: "2026-06-15", description: "Netflix", suggestedCategory: "Assinaturas", confidence: 0.95 },
                  { type: "expense", amountCents: 1240, date: "2026-06-20", description: "Uber", confidence: 0.88 },
                ],
              }),
            },
          },
        ],
        usage: { total_tokens: 200 },
      }),
    });

    const fakeS3 = {
      send: vi.fn().mockResolvedValue({
        Body: (async function* () { yield Buffer.from("fake pdf bytes"); })(),
      }),
    };

    const ai = new OpenRouterGateway("key", "vision-x", "text-x");

    await processPdfInvoice(
      { jobId: "job1", workspaceId: "ws1", userId: "u1", storagePath: "ws1/invoice.pdf" },
      { ai, s3: fakeS3 as never, s3Bucket: "receipts" },
    );

    expect(createdDrafts).toHaveLength(2);
    const d0 = createdDrafts[0] as { description: string; categoryId: string };
    expect(d0.description).toBe("Netflix");
    expect(d0.categoryId).toBe("cat1");
  });
});
