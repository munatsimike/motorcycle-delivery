import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { INCOMING_IMAGE_MAX_BYTES } from './licence.constants.js';
import { ProfilePhotoValidationError, sanitizeProfilePhoto } from './profile-photo-sanitizer.js';
import { PROFILE_PHOTO_MAX_EDGE } from './profile-photo.constants.js';

describe('sanitizeProfilePhoto', () => {
  it('accepts JPEG, PNG, and WebP and does not enlarge a small image', async () => {
    const small = await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#169B62' },
    }).jpeg().toBuffer();
    const sanitized = await sanitizeProfilePhoto(small, INCOMING_IMAGE_MAX_BYTES);
    expect(sanitized.contentType).toBe('image/jpeg');
    expect(sanitized.width).toBe(80);
    expect(sanitized.height).toBe(40);

    const png = await sanitizeProfilePhoto(await image('png', 32, 32), INCOMING_IMAGE_MAX_BYTES);
    const webp = await sanitizeProfilePhoto(await image('webp', 32, 32), INCOMING_IMAGE_MAX_BYTES);
    expect(png.contentType).toBe('image/png');
    expect(webp.contentType).toBe('image/webp');
  });

  it('downscales the longest edge to 1024px and strips metadata', async () => {
    const comment = 'GPS-LATITUDE-SECRET';
    const wide = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: '#17211D' },
    }).jpeg().toBuffer();
    const input = withJpegComment(wide, comment);
    const sanitized = await sanitizeProfilePhoto(input, INCOMING_IMAGE_MAX_BYTES);
    expect(sanitized.width).toBeLessThanOrEqual(PROFILE_PHOTO_MAX_EDGE);
    expect(sanitized.height).toBeLessThanOrEqual(PROFILE_PHOTO_MAX_EDGE);
    expect(Math.max(sanitized.width, sanitized.height)).toBe(PROFILE_PHOTO_MAX_EDGE);
    expect(sanitized.bytes.includes(Buffer.from(comment))).toBe(false);
  });

  it('rejects text, GIF bytes, and files over 5 MiB', async () => {
    await expect(sanitizeProfilePhoto(Buffer.from('<html></html>'), INCOMING_IMAGE_MAX_BYTES))
      .rejects.toBeInstanceOf(ProfilePhotoValidationError);
    await expect(sanitizeProfilePhoto(Buffer.from('GIF89a'), INCOMING_IMAGE_MAX_BYTES))
      .rejects.toMatchObject({ kind: 'type' });
    await expect(sanitizeProfilePhoto(Buffer.alloc(INCOMING_IMAGE_MAX_BYTES + 1), INCOMING_IMAGE_MAX_BYTES))
      .rejects.toMatchObject({ kind: 'size' });
  });
});

function image(format: 'png' | 'webp', width: number, height: number): Promise<Buffer> {
  const created = sharp({
    create: { width, height, channels: 3, background: '#169B62' },
  });
  return format === 'png' ? created.png().toBuffer() : created.webp().toBuffer();
}

function withJpegComment(jpeg: Buffer, comment: string): Buffer {
  const payload = Buffer.from(comment);
  const segment = Buffer.alloc(4 + payload.length);
  segment.writeUInt16BE(0xFFFE, 0);
  segment.writeUInt16BE(segment.length - 2, 2);
  payload.copy(segment, 4);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}
