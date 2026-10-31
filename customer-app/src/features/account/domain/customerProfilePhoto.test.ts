import { describe, expect, it } from 'vitest';

import {
  beginCustomerPhotoRemove,
  beginCustomerPhotoUpload,
  customerPhotoFileIssue,
  customerPhotoRemoved,
  customerPhotoRemoveFailed,
  customerPhotoUploadFailed,
  customerPhotoUploadStored,
  emptyCustomerPhoto,
  shownCustomerPhoto,
} from './customerProfilePhoto';

describe('customer profile photo', () => {
  it('shows a local preview while uploading and keeps the previous photo when replacement fails', () => {
    const stored = customerPhotoUploadStored(emptyCustomerPhoto(), 'data:image/jpeg;base64,old');
    const uploading = beginCustomerPhotoUpload(stored, 'file:///preview.jpg');
    expect(shownCustomerPhoto(uploading)).toBe('file:///preview.jpg');
    const failed = customerPhotoUploadFailed(uploading, 'Profile photo storage is unavailable');
    expect(shownCustomerPhoto(failed)).toBe('data:image/jpeg;base64,old');
    expect(failed.storedUri).toBe('data:image/jpeg;base64,old');
    expect(failed.error).toBe('Profile photo storage is unavailable');
  });

  it('returns to the initials avatar after removal and keeps the photo when removal fails', () => {
    const stored = customerPhotoUploadStored(emptyCustomerPhoto(), 'data:image/jpeg;base64,old');
    expect(shownCustomerPhoto(customerPhotoRemoved())).toBeNull();
    const failed = customerPhotoRemoveFailed(beginCustomerPhotoRemove(stored), 'Network request failed. Check your connection and try again.');
    expect(shownCustomerPhoto(failed)).toBe('data:image/jpeg;base64,old');
  });

  it('rejects an empty or oversized file before upload', () => {
    expect(customerPhotoFileIssue(0)).toBe('Choose a profile photo');
    expect(customerPhotoFileIssue(5 * 1024 * 1024 + 1)).toBe('Profile photo is too large');
    expect(customerPhotoFileIssue(1200)).toBeNull();
    expect(customerPhotoFileIssue(null)).toBeNull();
  });
});
