import { afterEach, describe, expect, it } from 'vitest';
import { ConfiguredObjectStorage } from './configured-object-storage.js';
import { DatabaseObjectStorage } from './database-object-storage.js';
import { S3ObjectStorage } from './s3-object-storage.js';

describe('image storage selection', () => {
  const env = ['LICENCE_STORAGE_BUCKET', 'LICENCE_STORAGE_REGION', 'LICENCE_STORAGE_ACCESS_KEY_ID', 'LICENCE_STORAGE_SECRET_ACCESS_KEY'];

  afterEach(() => {
    for (const name of env) {
      delete process.env[name];
    }
  });

  it('stores licence and profile images in the database when object storage is not configured', async () => {
    const objects = new Map<string, { body: Buffer; contentType: string }>();
    const database = new DatabaseObjectStorage(fakePrisma(objects));
    const s3 = new S3ObjectStorage(() => ({ send: async () => { throw new Error('object storage was used'); } }));
    const storage = new ConfiguredObjectStorage(s3, database);

    await storage.put('riders/profile/photo', Buffer.from('photo'), 'image/jpeg');
    await expect(storage.get('riders/profile/photo')).resolves.toEqual(Buffer.from('photo'));
    await storage.delete('riders/profile/photo');
    await expect(storage.get('riders/profile/photo')).rejects.toThrow('Licence image storage is unavailable');
    expect(objects.size).toBe(0);
  });

  it('uses the configured object store when licence storage is complete', async () => {
    process.env.LICENCE_STORAGE_BUCKET = 'licence-images';
    process.env.LICENCE_STORAGE_REGION = 'us-east-1';
    process.env.LICENCE_STORAGE_ACCESS_KEY_ID = 'licence-dev';
    process.env.LICENCE_STORAGE_SECRET_ACCESS_KEY = 'licence-dev-password';
    let used = false;
    const database = new DatabaseObjectStorage(fakePrisma(new Map()));
    const s3 = new S3ObjectStorage(() => ({
      async send() {
        used = true;
        return undefined;
      },
    }));
    const storage = new ConfiguredObjectStorage(s3, database);

    await storage.put('riders/profile/licences/image', Buffer.from('image'), 'image/jpeg');
    expect(used).toBe(true);
  });
});

function fakePrisma(objects: Map<string, { body: Buffer; contentType: string }>) {
  return {
    async $executeRaw(query: TemplateStringsArray | { strings: string[] }, ...values: unknown[]) {
      const text = sqlText(query);
      if (text.includes('CREATE TABLE')) {
        return 0;
      }
      if (text.includes('INSERT INTO stored_objects')) {
        objects.set(String(values[0]), { body: Buffer.from(values[1] as Uint8Array), contentType: String(values[2]) });
        return 1;
      }
      if (text.includes('DELETE FROM stored_objects')) {
        objects.delete(String(values[0]));
        return 1;
      }
      throw new Error(`Unexpected statement: ${text}`);
    },
    async $queryRaw(query: TemplateStringsArray | { strings: string[] }, ...values: unknown[]) {
      const text = sqlText(query);
      if (!text.includes('SELECT body FROM stored_objects')) {
        throw new Error(`Unexpected query: ${text}`);
      }
      const stored = objects.get(String(values[0]));
      return stored ? [{ body: stored.body }] : [];
    },
  } as never;
}

function sqlText(query: TemplateStringsArray | { strings: string[] }): string {
  return 'strings' in query ? query.strings.join(' ') : query.join(' ');
}
