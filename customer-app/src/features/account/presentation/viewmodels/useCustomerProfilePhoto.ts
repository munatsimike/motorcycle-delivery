import { useEffect, useSyncExternalStore } from 'react';
import * as ImagePicker from 'expo-image-picker';

import { errorMessage } from '../../../auth/presentation/errorMessage';
import { imageDataUrl } from '../../../deliveries/domain/profilePhotoImage';
import { apiGetBytes } from '../../../../services/api/apiClient';
import { customerAccountRepository } from '../../data/CustomerAccountApiRepository';
import type { CustomerAccount } from '../../domain/customerAccount';
import {
  beginCustomerPhotoRemove,
  beginCustomerPhotoUpload,
  customerPhotoFileIssue,
  customerPhotoRemoved,
  customerPhotoRemoveFailed,
  customerPhotoUploadFailed,
  customerPhotoUploadProgress,
  customerPhotoUploadStored,
  emptyCustomerPhoto,
  shownCustomerPhoto,
  type CustomerPhotoView,
} from '../../domain/customerProfilePhoto';
import { rememberCustomerAccount } from './customerAccountCache';

const listeners = new Set<() => void>();
let view = emptyCustomerPhoto();
let loadedAccountId: string | null = null;
let downloadAccountId: string | null = null;

function publish(next: CustomerPhotoView) {
  view = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return view;
}

export function useCustomerProfilePhoto(accessToken: string | null, account: CustomerAccount | null) {
  const photo = useSyncExternalStore(subscribe, snapshot, snapshot);
  const accountId = account?.id ?? null;

  useEffect(() => {
    if (loadedAccountId === accountId) {
      return;
    }
    loadedAccountId = accountId;
    downloadAccountId = null;
    publish(emptyCustomerPhoto());
  }, [accountId]);

  useEffect(() => {
    if (!accessToken || !accountId || !account?.hasProfilePhoto) {
      return;
    }
    if (snapshot().storedUri || snapshot().phase !== 'idle' || downloadAccountId === accountId) {
      return;
    }
    const requested = accountId;
    downloadAccountId = requested;
    void apiGetBytes('/customers/me/profile-photo', {
      accessToken,
      headers: { Accept: 'image/jpeg,image/png,image/webp' },
    }).then((bytes) => {
      if (loadedAccountId !== requested || snapshot().storedUri || snapshot().phase !== 'idle') {
        return;
      }
      const uri = bytes ? imageDataUrl(bytes) : null;
      if (uri) {
        publish(customerPhotoUploadStored(snapshot(), uri));
      }
    });
  }, [accessToken, account?.hasProfilePhoto, accountId]);

  async function changePhoto() {
    if (!accessToken || !account || snapshot().phase !== 'idle') {
      return;
    }
    const selected = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      exif: false,
      quality: 1,
    });
    if (selected.canceled || !selected.assets[0]) {
      return;
    }
    const asset = selected.assets[0];
    const issue = customerPhotoFileIssue(asset.fileSize);
    if (issue) {
      publish(customerPhotoUploadFailed(snapshot(), issue));
      return;
    }
    const type = asset.mimeType === 'image/png' || asset.mimeType === 'image/webp' ? asset.mimeType : 'image/jpeg';
    const name = type === 'image/png' ? 'profile.png' : type === 'image/webp' ? 'profile.webp' : 'profile.jpg';
    publish(beginCustomerPhotoUpload(snapshot(), asset.uri));
    try {
      await customerAccountRepository.uploadProfilePhoto(
        accessToken,
        { uri: asset.uri, name, type },
        (percent) => {
          publish(customerPhotoUploadProgress(snapshot(), percent));
        },
      );
      const bytes = await apiGetBytes('/customers/me/profile-photo', {
        accessToken,
        headers: { Accept: 'image/jpeg,image/png,image/webp' },
      });
      const uri = bytes ? imageDataUrl(bytes) : asset.uri;
      if (!uri) {
        throw new Error('Profile photo could not be loaded');
      }
      publish(customerPhotoUploadStored(snapshot(), uri));
      rememberCustomerAccount(accessToken, { ...account, hasProfilePhoto: true, photoUrl: null });
    } catch (caught: unknown) {
      publish(customerPhotoUploadFailed(snapshot(), errorMessage(caught, 'This photo could not be saved.')));
    }
  }

  async function removePhoto() {
    if (!accessToken || !account || snapshot().phase !== 'idle') {
      return;
    }
    publish(beginCustomerPhotoRemove(snapshot()));
    try {
      await customerAccountRepository.deleteProfilePhoto(accessToken);
      downloadAccountId = account.id;
      publish(customerPhotoRemoved());
      rememberCustomerAccount(accessToken, { ...account, hasProfilePhoto: false, photoUrl: null });
    } catch (caught: unknown) {
      publish(customerPhotoRemoveFailed(snapshot(), errorMessage(caught, 'This photo could not be removed.')));
    }
  }

  return {
    uri: shownCustomerPhoto(photo),
    phase: photo.phase,
    progress: photo.progress,
    error: photo.error,
    changePhoto,
    removePhoto,
  };
}
