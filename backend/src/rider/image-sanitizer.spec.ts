import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { LicenceImageValidationError, sanitizeLicenceImage } from './image-sanitizer.js';
import { INCOMING_IMAGE_MAX_BYTES } from './licence.constants.js';

describe('sanitizeLicenceImage', () => {
  it('accepts JPEG, PNG, and WebP bytes without trusting a filename', async () => {
    const jpeg = await sanitizeLicenceImage(await image('jpeg'), INCOMING_IMAGE_MAX_BYTES);
    const png = await sanitizeLicenceImage(await image('png'), INCOMING_IMAGE_MAX_BYTES);
    const webp = await sanitizeLicenceImage(await image('webp'), INCOMING_IMAGE_MAX_BYTES);
    expect(jpeg.contentType).toBe('image/jpeg');
    expect(png.contentType).toBe('image/png');
    expect(webp.contentType).toBe('image/webp');
    expect(jpeg.bytes.length).toBeGreaterThan(0);
  });

  it('rejects text and HTML instead of a renamed image', async () => {
    await expect(sanitizeLicenceImage(Buffer.from('plain text'), INCOMING_IMAGE_MAX_BYTES))
      .rejects.toMatchObject({ kind: 'type' });
    await expect(sanitizeLicenceImage(Buffer.from('<html></html>'), INCOMING_IMAGE_MAX_BYTES))
      .rejects.toBeInstanceOf(LicenceImageValidationError);
  });

  it('rejects an incoming file over 5 MiB and a sanitized file over the storage limit', async () => {
    await expect(sanitizeLicenceImage(Buffer.alloc(INCOMING_IMAGE_MAX_BYTES + 1), INCOMING_IMAGE_MAX_BYTES))
      .rejects.toMatchObject({ kind: 'size' });
    await expect(sanitizeLicenceImage(await image('png'), 1)).rejects.toMatchObject({ kind: 'size' });
  });

  it('strips embedded image metadata before storage', async () => {
    const comment = 'GPS-LATITUDE-SECRET';
    const input = withJpegComment(await image('jpeg'), comment);
    const sanitized = await sanitizeLicenceImage(input, INCOMING_IMAGE_MAX_BYTES);
    expect(sanitized.bytes.includes(Buffer.from(comment))).toBe(false);
    expect(sanitized.bytes.equals(input)).toBe(false);
  });
});

function image(format: 'jpeg' | 'png' | 'webp'): Promise<Buffer> {
  const created = sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 20, g: 40, b: 60 } },
  });
  if (format === 'jpeg') {
    return created.jpeg().toBuffer();
  }
  if (format === 'png') {
    return created.png().toBuffer();
  }
  return created.webp().toBuffer();
}

function withJpegComment(jpeg: Buffer, comment: string): Buffer {
  const payload = Buffer.from(comment, 'utf8');
  const segment = Buffer.alloc(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = 0xfe;
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}
