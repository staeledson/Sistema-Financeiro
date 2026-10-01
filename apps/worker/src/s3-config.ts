import type { S3ClientConfig } from "@aws-sdk/client-s3";

/**
 * Configuração do cliente S3 a partir do ambiente (MinIO local, bucket da Railway, R2...).
 * MINIO_REGION (padrão us-east-1) e MINIO_FORCE_PATH_STYLE (padrão true; "false" usa virtual-hosted).
 * Mantenha igual à da API (apps/api/src/storage/s3-config.ts).
 */
export function s3ClientConfig(env: NodeJS.ProcessEnv): S3ClientConfig {
  return {
    endpoint: env["MINIO_ENDPOINT"] ?? "http://localhost:9010",
    region: env["MINIO_REGION"]?.trim() || "us-east-1",
    credentials: {
      accessKeyId: env["MINIO_ACCESS_KEY"] ?? "minio",
      secretAccessKey: env["MINIO_SECRET_KEY"] ?? "minio123",
    },
    forcePathStyle: env["MINIO_FORCE_PATH_STYLE"]?.trim().toLowerCase() !== "false",
  };
}
