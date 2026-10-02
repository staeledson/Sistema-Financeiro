import { describe, expect, it } from "vitest";
import { mimeFromPath } from "../src/ai/mime";

describe("mimeFromPath", () => {
  it("imagens", () => {
    expect(mimeFromPath("ws/a.jpg", "image")).toBe("image/jpeg");
    expect(mimeFromPath("ws/a.PNG", "image")).toBe("image/png");
    expect(mimeFromPath("ws/a.heic", "image")).toBe("image/heic");
    expect(mimeFromPath("ws/a", "image")).toBe("image/jpeg");
  });
  it("áudios", () => {
    expect(mimeFromPath("ws/a.webm", "audio")).toBe("audio/webm");
    expect(mimeFromPath("ws/a.m4a", "audio")).toBe("audio/mp4");
    expect(mimeFromPath("ws/a.mp3", "audio")).toBe("audio/mpeg");
    expect(mimeFromPath("ws/a.xyz", "audio")).toBe("audio/webm");
  });
});
