import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ObjectStorage } from './object-storage.js';

const READY = Prisma.sql`
  CREATE TABLE IF NOT EXISTS stored_objects (
    object_key varchar(200) PRIMARY KEY,
    body bytea NOT NULL,
    content_type varchar(40) NOT NULL
  )
`;

@Injectable()
export class DatabaseObjectStorage extends ObjectStorage {
  private ready: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureReady();
    const bytes = new Uint8Array(body);
    await this.prisma.$executeRaw`
      INSERT INTO stored_objects (object_key, body, content_type)
      VALUES (${key}, ${bytes}, ${contentType})
      ON CONFLICT (object_key) DO UPDATE
      SET body = EXCLUDED.body, content_type = EXCLUDED.content_type
    `;
  }

  async get(key: string): Promise<Buffer> {
    await this.ensureReady();
    const rows = await this.prisma.$queryRaw<Array<{ body: Buffer | Uint8Array }>>`
      SELECT body FROM stored_objects WHERE object_key = ${key}
    `;
    const body = rows[0]?.body;
    if (!body) {
      throw new ServiceUnavailableException('Licence image storage is unavailable');
    }
    return Buffer.from(body);
  }

  async delete(key: string): Promise<void> {
    await this.ensureReady();
    await this.prisma.$executeRaw`
      DELETE FROM stored_objects WHERE object_key = ${key}
    `;
  }

  private ensureReady(): Promise<void> {
    this.ready ??= this.prisma.$executeRaw(READY).then(() => undefined);
    return this.ready;
  }
}
