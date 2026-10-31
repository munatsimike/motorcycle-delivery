import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UserRole } from '../generated/prisma/client.js';
import { CustomerAccountProfilePhotoController } from './customer-account-profile-photo.controller.js';

const CUSTOMER = { userId: 'user-1', role: UserRole.CUSTOMER, customerAccountId: 'account-1' };

describe('CustomerAccountProfilePhotoController', () => {
  const photos = {
    async upload() {
      return { id: 'photo-1', contentType: 'image/jpeg', byteSize: 12, uploadedAt: '2026-10-30T09:00:00.000Z' };
    },
    async image() {
      return { bytes: Buffer.from('photo'), contentType: 'image/jpeg' };
    },
    async remove() {
      return undefined;
    },
  };
  const controller = new CustomerAccountProfilePhotoController(photos as never);

  it('requires an authenticated customer', async () => {
    expect(() => controller.upload({}, { buffer: Buffer.from('photo') })).toThrow(ForbiddenException);
    await expect(controller.image({})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.remove({})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uploads only the authenticated customer photo and omits the object key', async () => {
    const response = await controller.upload({ customer: CUSTOMER }, { buffer: Buffer.from('photo') });
    expect(JSON.stringify(response)).not.toContain('objectKey');
    expect(JSON.stringify(response)).not.toContain('profile-photos');
    expect(response).toMatchObject({ contentType: 'image/jpeg' });
  });
});
