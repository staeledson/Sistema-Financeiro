import { Injectable, OnModuleInit } from "@nestjs/common";
import { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = process.env["MINIO_BUCKET"] ?? "receipts";
    this.s3 = new S3Client({
      endpoint: process.env["MINIO_ENDPOINT"] ?? "http://localhost:9000",
      region: "us-east-1",
      credentials: {
        accessKeyId: process.env["MINIO_ACCESS_KEY"] ?? "minio",
        secretAccessKey: process.env["MINIO_SECRET_KEY"] ?? "minio123",
      },
      forcePathStyle: true,
    });
  }

  async onModuleInit() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch {
        // MinIO unavailable (tests or dev without storage) — skip bucket init
      }
    }
  }

  async presignedUploadUrl(key: string, contentType: string, expiresIn = 300): Promise<string> {
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    return getSignedUrl(this.s3, cmd, { expiresIn });
  }

  get bucketName() { return this.bucket; }
}
