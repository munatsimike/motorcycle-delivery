import { apiBaseUrl } from '../config/env';
import { ApiError } from '../api/client';
import { readCustomerAccount, type CustomerAccount } from '../auth/contracts';
import { apiRequest } from '../api/client';

export function uploadProfilePhoto(accessToken: string, file: File, onProgress?: (percent: number) => void): Promise<void> {
  const body = new FormData();
  body.append('image', file, file.name);
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${apiBaseUrl()}/customers/me/profile-photo`);
    request.setRequestHeader('Accept', 'application/json');
    request.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new ApiError('Profile photo is unavailable.', request.status));
    };
    request.onerror = () => reject(new Error('Network request failed. Check your connection and try again.'));
    request.send(body);
  });
}

export function deleteProfilePhoto(accessToken: string): Promise<void> {
  return apiRequest('/customers/me/profile-photo', { method: 'DELETE', accessToken }).then(() => undefined);
}

export function loadCustomerAccount(accessToken: string): Promise<CustomerAccount> {
  return apiRequest<unknown>('/customers/me', { accessToken }).then(readCustomerAccount);
}

export async function loadProfilePhoto(accessToken: string): Promise<Blob | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${apiBaseUrl()}/customers/me/profile-photo`, {
      headers: {
        Accept: 'image/*',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new ApiError('Profile photo is unavailable.', response.status);
    }
    const type = response.headers.get('Content-Type') ?? '';
    if (!type.startsWith('image/')) {
      throw new ApiError('Profile photo is unavailable.', response.status);
    }
    return await response.blob();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The request timed out. Check your connection and try again.');
    }
    throw new Error('Network request failed. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}
