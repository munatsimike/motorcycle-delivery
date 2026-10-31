import sharp from 'sharp';
import { INCOMING_IMAGE_MAX_BYTES, MAX_IMAGE_EDGE } from './licence.constants.js';
import { PROFILE_PHOTO_MAX_EDGE } from './profile-photo.constants.js';

const CONTENT_TYPE = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

type ImageFormat = keyof typeof CONTENT_TYPE;

export class ProfilePhotoValidationError extends Error {
  constructor(readonly kind: 'size' | 'type') {
    super(kind === 'size' ? 'Profile photo is too large' : 'Profile photo must be a JPEG, PNG, or WebP file');
    this.name = 'ProfilePhotoValidationError';
  }
}

export type SanitizedProfilePhoto = {
  bytes: Buffer;
  contentType: (typeof CONTENT_TYPE)[ImageFormat];
  width: number;
  height: number;
};

export async function sanitizeProfilePhoto(input: Buffer, maxStoredBytes: number): Promise<SanitizedProfilePhoto> {
  if (input.length === 0 || input.length > INCOMING_IMAGE_MAX_BYTES) {
    throw new ProfilePhotoValidationError('size');
  }

  try {
    const source = sharp(input, {
      failOn: 'error',
      animated: false,
      limitInputPixels: MAX_IMAGE_EDGE * MAX_IMAGE_EDGE,
    });
    const metadata = await source.metadata();
    const format = metadata.format;
    if (!isSupportedFormat(format)) {
      throw new ProfilePhotoValidationError('type');
    }
    if (!metadata.width || !metadata.height || metadata.width > MAX_IMAGE_EDGE || metadata.height > MAX_IMAGE_EDGE) {
      throw new ProfilePhotoValidationError('type');
    }

    const longest = Math.max(metadata.width, metadata.height);
    let pipeline = sharp(input, { failOn: 'error', animated: false }).rotate();
    if (longest > PROFILE_PHOTO_MAX_EDGE) {
      pipeline = pipeline.resize({
        width: PROFILE_PHOTO_MAX_EDGE,
        height: PROFILE_PHOTO_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    const bytes = format === 'jpeg'
      ? await pipeline.jpeg({ quality: 85 }).toBuffer()
      : format === 'png'
        ? await pipeline.png().toBuffer()
        : await pipeline.webp().toBuffer();
    if (bytes.length === 0 || bytes.length > maxStoredBytes) {
      throw new ProfilePhotoValidationError('size');
    }
    const stored = await sharp(bytes).metadata();
    return {
      bytes,
      contentType: CONTENT_TYPE[format],
      width: stored.width ?? metadata.width,
      height: stored.height ?? metadata.height,
    };
  } catch (error) {
    if (error instanceof ProfilePhotoValidationError) {
      throw error;
    }
    throw new ProfilePhotoValidationError('type');
  }
}

function isSupportedFormat(format: string | undefined): format is ImageFormat {
  return format === 'jpeg' || format === 'png' || format === 'webp';
}
