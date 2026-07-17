import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface UploadResult {
  bucket: string;
  key: string;
  url: string;
}

/**
 * S3-compatible storage wrapper (MinIO in dev, any S3 provider in prod).
 * Bucket-per-purpose: `bucketFor('documents')` reads `S3_BUCKET_DOCUMENTS`,
 * falling back to `S3_BUCKET_DEFAULT`. Purposes are introduced by the
 * modules that need them (photos, documents, certificates, ...).
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly defaultBucket: string;

  constructor(private readonly config: ConfigService) {
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>('s3.endpoint'),
      region: config.getOrThrow<string>('s3.region'),
      forcePathStyle: config.getOrThrow<boolean>('s3.forcePathStyle'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('s3.accessKey'),
        secretAccessKey: config.getOrThrow<string>('s3.secretKey'),
      },
    });
    this.defaultBucket = config.getOrThrow<string>('s3.defaultBucket');
  }

  bucketFor(purpose?: string): string {
    if (!purpose) return this.defaultBucket;
    return (
      process.env[`S3_BUCKET_${purpose.toUpperCase()}`] ?? this.defaultBucket
    );
  }

  /** Uploads under `<prefix>/<uuid>.<ext>`; returns the object location. */
  async upload(params: {
    body: Buffer | Uint8Array | string;
    contentType: string;
    prefix?: string;
    filename?: string;
    purpose?: string;
  }): Promise<UploadResult> {
    const bucket = this.bucketFor(params.purpose);
    const ext = params.filename?.includes('.')
      ? params.filename.slice(params.filename.lastIndexOf('.'))
      : '';
    const key = `${params.prefix ? `${params.prefix}/` : ''}${randomUUID()}${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: params.body,
        ContentType: params.contentType,
      }),
    );

    return {
      bucket,
      key,
      url: await this.getSignedUrl(key, 3600, params.purpose),
    };
  }

  async getSignedUrl(
    key: string,
    expiresInSeconds = 3600,
    purpose?: string,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucketFor(purpose), Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async delete(key: string, purpose?: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketFor(purpose), Key: key }),
    );
  }

  /** Fetches an object's bytes (M09: embedding photos into ID-card PDFs). */
  async download(key: string, purpose?: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucketFor(purpose), Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object ${key} has no body`);
    return Buffer.from(bytes);
  }
}
