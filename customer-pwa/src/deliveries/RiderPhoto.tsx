import { useEffect, useState } from 'react';
import { apiBaseUrl } from '../config/env';
import { riderInitials, riderPhotoPresentation } from './tracking';

export function RiderPhoto({
  name,
  hasProfilePhoto,
  path,
  accessToken,
  tile = false,
}: {
  name: string;
  hasProfilePhoto: boolean;
  path: string | null;
  accessToken: string | null;
  tile?: boolean;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!hasProfilePhoto || !path || !accessToken) {
      setPhotoUrl(null);
      return undefined;
    }
    let active = true;
    let objectUrl = '';
    void fetch(`${apiBaseUrl()}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'image/jpeg,image/png,image/webp' },
      cache: 'no-store',
    }).then(async (response) => {
      if (!active || !response.ok) return null;
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) return null;
      objectUrl = URL.createObjectURL(blob);
      return objectUrl;
    }).then((url) => {
      if (!active) return;
      if (!url) {
        console.warn('Profile photo could not be loaded');
        setFailed(true);
      }
      setPhotoUrl(url);
    }).catch((error: unknown) => {
      console.warn('Profile photo could not be loaded', error);
      if (active) {
        setPhotoUrl(null);
        setFailed(true);
      }
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accessToken, hasProfilePhoto, path]);
  const mode = riderPhotoPresentation({ hasProfilePhoto, photoUrl, failed });
  return (
    <span className={tile ? 'track-avatar offer-avatar' : 'track-avatar'} aria-label={mode === 'photo' ? `${name} profile photo` : `${name} initials`}>
      {mode === 'photo' && photoUrl ? <img src={photoUrl} alt="" onError={() => { console.warn('Profile photo could not be loaded'); setFailed(true); }} /> : riderInitials(name)}
    </span>
  );
}
