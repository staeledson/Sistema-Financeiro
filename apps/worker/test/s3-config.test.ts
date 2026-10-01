import { describe, it, expect } from "vitest";
import { s3ClientConfig } from "../src/s3-config";

describe("s3ClientConfig", () => {
  it("padrões: us-east-1 e path-style (MinIO local)", () => {
    const c = s3ClientConfig({});
    expect(c.region).toBe("us-east-1");
    expect(c.forcePathStyle).toBe(true);
    expect(c.endpoint).toBe("http://localhost:9010");
  });

  it("MINIO_REGION sobrescreve a região", () => {
    expect(s3ClientConfig({ MINIO_REGION: "auto" }).region).toBe("auto");
    expect(s3ClientConfig({ MINIO_REGION: "  " }).region).toBe("us-east-1");
  });

  it("MINIO_FORCE_PATH_STYLE=false usa virtual-hosted; outros valores mantêm path-style", () => {
    expect(s3ClientConfig({ MINIO_FORCE_PATH_STYLE: "false" }).forcePathStyle).toBe(false);
    expect(s3ClientConfig({ MINIO_FORCE_PATH_STYLE: " FALSE " }).forcePathStyle).toBe(false);
    expect(s3ClientConfig({ MINIO_FORCE_PATH_STYLE: "true" }).forcePathStyle).toBe(true);
    expect(s3ClientConfig({ MINIO_FORCE_PATH_STYLE: "0" }).forcePathStyle).toBe(true);
  });
});
