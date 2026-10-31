export const CUSTOMER_PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export type CustomerPhotoPhase = 'idle' | 'uploading' | 'removing';

export type CustomerPhotoView = {
  storedUri: string | null;
  previewUri: string | null;
  phase: CustomerPhotoPhase;
  progress: number | null;
  error: string | null;
};

export function emptyCustomerPhoto(): CustomerPhotoView {
  return {
    storedUri: null,
    previewUri: null,
    phase: 'idle',
    progress: null,
    error: null,
  };
}

export function shownCustomerPhoto(view: CustomerPhotoView): string | null {
  if (view.phase === 'uploading' && view.previewUri) {
    return view.previewUri;
  }
  return view.storedUri;
}

export function customerPhotoFileIssue(size: number | null | undefined): string | null {
  if (size === 0) {
    return 'Choose a profile photo';
  }
  if (size != null && size > CUSTOMER_PROFILE_PHOTO_MAX_BYTES) {
    return 'Profile photo is too large';
  }
  return null;
}

export function beginCustomerPhotoUpload(view: CustomerPhotoView, previewUri: string): CustomerPhotoView {
  return {
    ...view,
    previewUri,
    phase: 'uploading',
    progress: 0,
    error: null,
  };
}

export function customerPhotoUploadProgress(view: CustomerPhotoView, progress: number): CustomerPhotoView {
  if (view.phase !== 'uploading') {
    return view;
  }
  return { ...view, progress };
}

export function customerPhotoUploadFailed(view: CustomerPhotoView, error: string): CustomerPhotoView {
  return {
    ...view,
    previewUri: null,
    phase: 'idle',
    progress: null,
    error,
  };
}

export function customerPhotoUploadStored(view: CustomerPhotoView, storedUri: string): CustomerPhotoView {
  return {
    storedUri,
    previewUri: null,
    phase: 'idle',
    progress: null,
    error: null,
  };
}

export function beginCustomerPhotoRemove(view: CustomerPhotoView): CustomerPhotoView {
  return { ...view, phase: 'removing', progress: null, error: null };
}

export function customerPhotoRemoved(): CustomerPhotoView {
  return emptyCustomerPhoto();
}

export function customerPhotoRemoveFailed(view: CustomerPhotoView, error: string): CustomerPhotoView {
  return { ...view, phase: 'idle', progress: null, error };
}
