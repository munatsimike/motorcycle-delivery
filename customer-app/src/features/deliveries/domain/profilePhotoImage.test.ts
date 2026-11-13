import { describe, expect, it } from 'vitest';

import { imageDataUrl } from './profilePhotoImage';

describe('profile photo images', () => {
  it('keeps a jpeg byte payload as a jpeg data url', () => {
    const bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
    expect(imageDataUrl(bytes)).toBe('data:image/jpeg;base64,/9j/AA==');
  });

  it('rejects bytes that are not a profile photo', () => {
    expect(imageDataUrl(Uint8Array.of(1, 2, 3, 4))).toBeNull();
  });
});
