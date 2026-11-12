import { Injectable } from '@nestjs/common';
import { DatabaseObjectStorage } from './database-object-storage.js';
import { ObjectStorage } from './object-storage.js';
import { licenceStorageConfigured, S3ObjectStorage } from './s3-object-storage.js';

@Injectable()
export class ConfiguredObjectStorage extends ObjectStorage {
  constructor(
    private readonly s3: S3ObjectStorage,
    private readonly database: DatabaseObjectStorage,
  ) {
    super();
  }

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    return this.selected().put(key, body, contentType);
  }

  get(key: string): Promise<Buffer> {
    return this.selected().get(key);
  }

  delete(key: string): Promise<void> {
    return this.selected().delete(key);
  }

  private selected(): ObjectStorage {
    return licenceStorageConfigured() ? this.s3 : this.database;
  }
}
