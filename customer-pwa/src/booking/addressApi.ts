import { apiRequest } from '../api/client';
import type { SavedAddress } from './savedAddress';

export function listSavedAddresses(accessToken: string): Promise<unknown> {
  return apiRequest('/customers/me/addresses', { accessToken });
}

export function createSavedAddress(accessToken: string, body: unknown): Promise<unknown> {
  return apiRequest('/customers/me/addresses', { method: 'POST', body, accessToken });
}

export function updateSavedAddress(accessToken: string, id: string, body: unknown): Promise<unknown> {
  return apiRequest(`/customers/me/addresses/${id}`, { method: 'PATCH', body, accessToken });
}

export function deleteSavedAddress(accessToken: string, id: string): Promise<void> {
  return apiRequest(`/customers/me/addresses/${id}`, { method: 'DELETE', accessToken });
}

export type { SavedAddress };
