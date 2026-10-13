import { BadRequestException, ForbiddenException, StreamableFile } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { RiderAdminController } from './rider-admin.controller.js';
import { RiderOnboardingController } from './rider-onboarding.controller.js';

describe('rider admin and onboarding controllers', () => {
  const admin = new RiderAdminController({
    async review() {
      return { ok: true };
    },
    async currentImage() {
      return { bytes: Buffer.from('image'), contentType: 'image/jpeg' };
    },
  } as never, {
    async decide() {
      return { ok: true };
    },
  } as never);
  const onboarding = new RiderOnboardingController({} as never);

  it('requires an admin for licence review, image access, and approval', async () => {
    expect(() => admin.verifyLicence({}, 'profile-1', { decision: 'VERIFY' })).toThrow(ForbiddenException);
    await expect(admin.licenceImage({}, 'profile-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => admin.approval({}, 'profile-1', { decision: 'APPROVE' })).toThrow(ForbiddenException);
    expect(() => admin.verifyLicence({ admin: { userId: 'admin-1' } }, 'profile-1', { decision: 'CLOSE' })).toThrow(BadRequestException);
    expect(() => admin.approval({ admin: { userId: 'admin-1' } }, 'profile-1', { decision: 'REJECT' })).toThrow(BadRequestException);
    expect(() => onboarding.current({})).toThrow(ForbiddenException);
  });

  it('returns image bytes without a stored filename', async () => {
    const file = await admin.licenceImage({ admin: { userId: 'admin-1' } }, 'profile-1');
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.options).toMatchObject({ type: 'image/jpeg', disposition: 'inline' });
    expect(JSON.stringify(file.options)).not.toContain('riders/');
  });
});
