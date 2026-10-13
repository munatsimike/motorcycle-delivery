import { DeleteObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ObjectStorage } from './object-storage.js';

export const S3_CLIENT_FACTORY = Symbol('S3_CLIENT_FACTORY');

type StorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type ObjectClient = {
  send(command: unknown): Promise<unknown>;
};

@Injectable()
export class S3ObjectStorage extends ObjectStorage {
  constructor(
    @Inject(S3_CLIENT_FACTORY) private readonly clientFactory: (config: StorageConfig) => ObjectClient,
  ) {
    super();
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const config = storageConfig();
    await this.clientFactory(config).send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: 'private',
    }));
  }

  async delete(key: string): Promise<void> {
    const config = storageConfig();
    try {
      await this.clientFactory(config).send(new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }));
    } catch (error) {
      if (isMissingObject(error)) {
        return;
      }
      throw error;
    }
  }
}

export function s3ClientOptions(config: StorageConfig): S3ClientConfig {
  return {
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
}

export function isMissingObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  const status = '$metadata' in error && typeof error.$metadata === 'object' && error.$metadata !== null && 'httpStatusCode' in error.$metadata
    ? error.$metadata.httpStatusCode
    : undefined;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

export function createS3Client(config: StorageConfig): ObjectClient {
  return new S3Client(s3ClientOptions(config));
}

function storageConfig(): StorageConfig {
  const bucket = process.env.LICENCE_STORAGE_BUCKET ?? '';
  const region = process.env.LICENCE_STORAGE_REGION ?? '';
  const accessKeyId = process.env.LICENCE_STORAGE_ACCESS_KEY_ID ?? '';
  const secretAccessKey = process.env.LICENCE_STORAGE_SECRET_ACCESS_KEY ?? '';
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new ServiceUnavailableException('Licence image storage is unavailable');
  }
  const endpoint = process.env.LICENCE_STORAGE_ENDPOINT;
  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    endpoint: endpoint ? endpoint : undefined,
  };
}
