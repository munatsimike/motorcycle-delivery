import sharp from 'sharp';
import { INCOMING_IMAGE_MAX_BYTES, MAX_IMAGE_EDGE } from './licence.constants.js';

const CONTENT_TYPE = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

type ImageFormat = keyof typeof CONTENT_TYPE;

export class LicenceImageValidationError extends Error {
  constructor(readonly kind: 'size' | 'type') {
    super(kind === 'size' ? 'Licence image is too large' : 'Licence image must be a JPEG, PNG, or WebP file');
    this.name = 'LicenceImageValidationError';
  }
}

export type SanitizedLicenceImage = {
  bytes: Buffer;
  contentType: (typeof CONTENT_TYPE)[ImageFormat];
};

export async function sanitizeLicenceImage(input: Buffer, maxStoredBytes: number): Promise<SanitizedLicenceImage> {
  if (input.length === 0 || input.length > INCOMING_IMAGE_MAX_BYTES) {
    throw new LicenceImageValidationError('size');
  }

  try {
    const metadata = await sharp(input, {
      failOn: 'error',
      animated: false,
      limitInputPixels: MAX_IMAGE_EDGE * MAX_IMAGE_EDGE,
    }).metadata();
    const format = metadata.format;
    if (!isSupportedFormat(format)) {
      throw new LicenceImageValidationError('type');
    }
    if (!metadata.width || !metadata.height || metadata.width > MAX_IMAGE_EDGE || metadata.height > MAX_IMAGE_EDGE) {
      throw new LicenceImageValidationError('type');
    }

    const pipeline = sharp(input, { failOn: 'error', animated: false }).rotate();
    const bytes = format === 'jpeg'
      ? await pipeline.jpeg({ quality: 85 }).toBuffer()
      : format === 'png'
        ? await pipeline.png().toBuffer()
        : await pipeline.webp().toBuffer();
    if (bytes.length === 0 || bytes.length > maxStoredBytes) {
      throw new LicenceImageValidationError('size');
    }
    return { bytes, contentType: CONTENT_TYPE[format] };
  } catch (error) {
    if (error instanceof LicenceImageValidationError) {
      throw error;
    }
    throw new LicenceImageValidationError('type');
  }
}

function isSupportedFormat(format: string | undefined): format is ImageFormat {
  return format === 'jpeg' || format === 'png' || format === 'webp';
}
