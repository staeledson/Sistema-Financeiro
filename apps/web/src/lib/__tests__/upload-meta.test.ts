import { describe, expect, it } from "vitest";
import { imageUploadMeta } from "../upload-meta";

describe("imageUploadMeta", () => {
  it("usa extensão e tipo do arquivo quando válidos", () => {
    expect(imageUploadMeta({ name: "nota.PNG", type: "image/png" })).toEqual({ ext: "png", contentType: "image/png" });
  });
  it("arquivo sem ponto ou com extensão estranha cai em jpg", () => {
    expect(imageUploadMeta({ name: "IMG_1234", type: "image/jpeg" }).ext).toBe("jpg");
    expect(imageUploadMeta({ name: "a.tar.gz_x", type: "image/jpeg" }).ext).toBe("jpg");
  });
  it("tipo vazio ou fora do padrão cai em image/jpeg", () => {
    expect(imageUploadMeta({ name: "foto.heic", type: "" })).toEqual({ ext: "heic", contentType: "image/jpeg" });
    expect(imageUploadMeta({ name: "x.jpg", type: "text/html" }).contentType).toBe("image/jpeg");
  });
});
