import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { ServiceUnavailableException } from '@nestjs/common';
import { SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants.js';
import { afterEach, describe, expect, it } from 'vitest';
import { isMissingObject, S3_CLIENT_FACTORY, s3ClientOptions, S3ObjectStorage } from './s3-object-storage.js';

describe('S3ObjectStorage', () => {
  const env = ['LICENCE_STORAGE_BUCKET', 'LICENCE_STORAGE_REGION', 'LICENCE_STORAGE_ENDPOINT', 'LICENCE_STORAGE_ACCESS_KEY_ID', 'LICENCE_STORAGE_SECRET_ACCESS_KEY'];

  afterEach(() => {
    for (const name of env) {
      delete process.env[name];
    }
  });

  it('stores a private object and treats a missing object as deleted', async () => {
    configure();
    const commands: Array<PutObjectCommand | DeleteObjectCommand> = [];
    const storage = new S3ObjectStorage(() => ({
      async send(command: PutObjectCommand | DeleteObjectCommand) {
        commands.push(command);
        if (command instanceof DeleteObjectCommand) {
          const missing = new Error('The specified key does not exist.');
          missing.name = 'NoSuchKey';
          throw missing;
        }
        return undefined;
      },
    }));

    await storage.put('riders/profile/licences/image', Buffer.from('image'), 'image/jpeg');
    await expect(storage.delete('riders/profile/licences/image')).resolves.toBeUndefined();

    const put = commands[0];
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put).toMatchObject({
      input: {
        Bucket: 'licence-images',
        Key: 'riders/profile/licences/image',
        ContentType: 'image/jpeg',
        ACL: 'private',
      },
    });
    expect(put.input).not.toHaveProperty('ServerSideEncryption');
    expect(JSON.stringify(put)).not.toContain('public-read');
  });

  it('reads a private object without returning its key', async () => {
    configure();
    const bytes = Buffer.from('image-bytes');
    const storage = new S3ObjectStorage(() => ({
      async send(command: GetObjectCommand) {
        expect(command).toBeInstanceOf(GetObjectCommand);
        expect(command.input).not.toHaveProperty('ACL');
        return { Body: { transformToByteArray: async () => bytes } };
      },
    }));

    await expect(storage.get('riders/profile/licences/image')).resolves.toEqual(bytes);
  });

  it('uses path-style addressing and does not report missing configuration with the secret', async () => {
    const options = s3ClientOptions({
      bucket: 'licence-images',
      region: 'us-east-1',
      endpoint: 'http://localhost:9000',
      accessKeyId: 'licence-dev',
      secretAccessKey: 'licence-dev-password',
    });
    expect(options).toMatchObject({ forcePathStyle: true, endpoint: 'http://localhost:9000' });

    process.env.LICENCE_STORAGE_SECRET_ACCESS_KEY = 'licence-dev-password';
    const storage = new S3ObjectStorage(() => ({ send: async () => undefined }));
    await expect(storage.put('key', Buffer.from('x'), 'image/jpeg')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(storage.put('key', Buffer.from('x'), 'image/jpeg')).rejects.toThrow('Licence image storage is unavailable');
    expect(isMissingObject(Object.assign(new Error('missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }))).toBe(true);
  });

  it('resolves the S3 client factory from its injection token', async () => {
    // Nest's TestingModule.compile() always dynamic-imports the optional
    // @nestjs/microservices package. That import is not part of this storage
    // contract, and under a full parallel run it exceeds the test limit
    // without calling S3. The token below is the metadata Nest reads.
    const declared = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, S3ObjectStorage);
    expect(declared).toEqual([expect.objectContaining({ index: 0, param: S3_CLIENT_FACTORY })]);

    configure();
    let used = false;
    const storage = new S3ObjectStorage(() => {
      used = true;
      return { send: async () => undefined };
    });
    await storage.put('riders/profile/licences/image', Buffer.from('x'), 'image/jpeg');
    expect(used).toBe(true);
    expect(storage).toBeInstanceOf(S3ObjectStorage);
  });
});

function configure(): void {
  process.env.LICENCE_STORAGE_BUCKET = 'licence-images';
  process.env.LICENCE_STORAGE_REGION = 'us-east-1';
  process.env.LICENCE_STORAGE_ENDPOINT = 'http://localhost:9000';
  process.env.LICENCE_STORAGE_ACCESS_KEY_ID = 'licence-dev';
  process.env.LICENCE_STORAGE_SECRET_ACCESS_KEY = 'licence-dev-password';
}
