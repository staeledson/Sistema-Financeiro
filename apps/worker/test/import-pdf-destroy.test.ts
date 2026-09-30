import { describe, it, expect, vi } from "vitest";

const pdf = vi.hoisted(() => ({ destroyCalls: 0 }));

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    constructor(_opts: { data: Uint8Array }) {}
    async getText(): Promise<{ text: string }> {
      throw new Error("pdf corrompido");
    }
    async destroy() {
      pdf.destroyCalls++;
    }
  },
}));
vi.mock("../src/database", () => ({ prisma: {} }));
vi.mock("@aws-sdk/client-s3", () => ({ GetObjectCommand: vi.fn(), S3Client: vi.fn() }));

import { processPdfInvoice } from "../src/import/pdf.processor";

describe("processPdfInvoice", () => {
  it("libera o parser (destroy) mesmo quando a leitura do PDF falha", async () => {
    const s3 = { send: async () => ({ Body: (async function* () { yield new Uint8Array([1, 2, 3]); })() }) };
    await expect(
      processPdfInvoice(
        { jobId: "j1", workspaceId: "w1", userId: "u1", storagePath: "k.pdf" },
        { ai: {} as never, s3: s3 as never, s3Bucket: "b" },
      ),
    ).rejects.toThrow("pdf corrompido");
    expect(pdf.destroyCalls).toBe(1);
  });
});
