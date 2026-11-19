import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { deleteProfilePhoto, loadCustomerAccount, loadProfilePhoto, uploadProfilePhoto } from '../account/profileApi';
import { customerAvatarColors, customerPhotoFileIssue, profileAvatarMark, profileRows } from '../account/profile';
import { clearStoredProfilePhoto, readStoredProfile, storeProfileAccount, storeProfilePhoto } from '../account/profileLoad';
import { isSessionRejection, type CustomerAccount } from '../auth/contracts';
import { isReplacementSignOut } from '../auth/replacementSignOut';
import { rememberReturnPath } from '../auth/returnPath';
import { useSession } from '../auth/sessionContext';
import { ErrorMessage } from '../components/ErrorMessage';
import { TopSpinner } from '../components/TopSpinner';
import { appearanceLabel, profileSignOutRequest, type AppearanceMode } from '../theme/appearance';
import { useAppearance } from '../theme/appearanceContext';
import { motionClass, usePresence } from '../motion/usePresence';
import { useContainedScroll } from '../app/useContainedScroll';

function MoreRowIcon({ kind }: { kind: string }) {
  const paths: Record<string, ReactNode> = {
    phone: <path d="M6.6 3.5 9 6.8 7.5 9c1.4 3 3.5 5.1 6.5 6.5l2.2-1.5 3.3 2.4-.7 3c-.2.8-1 1.3-1.8 1.2C9.8 19.4 4.6 14.2 3.4 7c-.1-.8.4-1.6 1.2-1.8l2-.7Z" />,
    appearance: <><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16V4Z"/></>,
    address: <><path d="M4 4h16v16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M4 17h16"/><circle cx="12" cy="9" r="2"/><path d="M8.5 14c.3-1.7 1.5-2.5 3.5-2.5s3.2.8 3.5 2.5"/></>,
    logout: <><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"/><path d="M14 8l4 4-4 4m4-4H8"/></>,
  };
  return <svg className="more-row-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind] ?? paths.phone}</svg>;
}

const APPEARANCE_OPTIONS: AppearanceMode[] = ['system', 'light', 'dark'];

export function ProfilePage() {
  const navigate = useNavigate();
  const { accessToken, signOut } = useSession();
  const { mode, scheme, setMode } = useAppearance();
  const remembered = readStoredProfile();
  const [account, setAccount] = useState<CustomerAccount | null>(remembered?.account ?? null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(remembered?.photoUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(remembered == null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'removing'>('idle');
  const [progress, setProgress] = useState(0);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const removeMotion = usePresence(removeOpen, 150);
  const appearanceMotion = usePresence(appearanceOpen, 220);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const photoRequest = useRef(0);
  const screenRef = useContainedScroll<HTMLElement>();

  useEffect(() => {
    let active = true;

    async function load() {
      if (!readStoredProfile()) setIsLoading(true);
      setError(null);
      try {
        const token = await accessToken();
        if (!active) return;
        if (!token) {
          rememberReturnPath('/more');
          navigate('/sign-in', { replace: true, state: { from: '/more' } });
          return;
        }
        const next = await loadCustomerAccount(token);
        if (!active) return;
        const painted = storeProfileAccount(next);
        setAccount(next);
        setPhotoUrl(painted.photoUrl);
        setIsLoading(false);
        if (!painted.fetchPhoto) return;
        const request = ++photoRequest.current;
        const url = await photoObjectUrl(token);
        if (request !== photoRequest.current) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        storeProfilePhoto(next.id, url);
        if (active) setPhotoUrl(url);
      } catch (caught) {
        if (!active) return;
        if (isSessionRejection(caught)) {
          rememberReturnPath('/more');
          await signOut();
          navigate('/sign-in', {
            replace: true,
            state: isReplacementSignOut(caught) ? { from: '/more' } : { from: '/more', notice: 'Your session ended. Sign in again.' },
          });
          return;
        }
        if (!readStoredProfile()) {
          setError(caught instanceof Error ? caught.message : 'Account details are unavailable.');
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [accessToken, navigate, signOut]);

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    const destination = profileSignOutRequest();
    navigate(destination.path, { replace: destination.replace, state: { leftAccount: destination.leftAccount } });
    void signOut();
  }

  async function changePhoto(file: File | undefined) {
    const issue = customerPhotoFileIssue(file?.size);
    if (!file || issue) {
      setPhotoError(issue ?? 'Choose a profile photo');
      return;
    }
    photoRequest.current += 1;
    setPhase('uploading');
    setProgress(0);
    setPhotoError(null);
    const preview = URL.createObjectURL(file);
    setPhotoUrl(preview);
    try {
      const token = await accessToken();
      if (!token) throw new Error('Profile photo is unavailable.');
      await uploadProfilePhoto(token, file, setProgress);
      const stored = await loadProfilePhoto(token);
      URL.revokeObjectURL(preview);
      const nextUrl = stored ? URL.createObjectURL(stored) : null;
      storeProfilePhoto(account?.id ?? null, nextUrl);
      setPhotoUrl(nextUrl);
      setAccount((current) => current ? { ...current, hasProfilePhoto: nextUrl != null } : current);
    } catch (caught) {
      URL.revokeObjectURL(preview);
      setPhotoUrl(readStoredProfile()?.photoUrl ?? null);
      setPhotoError(caught instanceof Error ? caught.message : 'Profile photo is unavailable.');
    } finally {
      setPhase('idle');
    }
  }

  async function removePhoto() {
    photoRequest.current += 1;
    setRemoveOpen(false);
    setPhase('removing');
    setPhotoError(null);
    try {
      const token = await accessToken();
      if (!token) throw new Error('Profile photo is unavailable.');
      await deleteProfilePhoto(token);
      clearStoredProfilePhoto(account?.id ?? null);
      setPhotoUrl(null);
      setAccount((current) => current ? { ...current, hasProfilePhoto: false } : current);
    } catch (caught) {
      setPhotoError(caught instanceof Error ? caught.message : 'Profile photo is unavailable.');
    } finally {
      setPhase('idle');
    }
  }

  const rows = account ? profileRows({ ...account, appearance: appearanceLabel(mode) }) : [];
  const contactRows = rows.filter((row) => row.action !== 'appearance');
  const appearanceRows = rows.filter((row) => row.action === 'appearance');
  const colors = account ? customerAvatarColors(account.id) : null;

  return (
    <main id="main" ref={screenRef} className="profile-screen">
      <div className={`profile-wash ${scheme === 'dark' ? 'is-dark' : ''}`} aria-hidden="true" />
      <div className="profile-sheet">
        {isLoading && !account ? (
          <div className="profile-loading">
            <TopSpinner active label="Loading profile" />
            <p aria-hidden="true">Loading profile</p>
          </div>
        ) : (
          <TopSpinner active={isLoading} label="Loading your profile" />
        )}
        {account ? (
          <>
            <div className="profile-identity">
              {phase === 'uploading' ? <p className="profile-photo-status">Uploading {progress}%</p> : null}
              {phase === 'removing' ? <p className="profile-photo-status">Removing photo</p> : null}
              <h1>{account.name}</h1>
            </div>
            <div className="profile-avatar-slot">
              <button type="button" className="profile-avatar" aria-label="Change profile photo" disabled={phase !== 'idle'} onClick={() => fileInput.current?.click()}>
                {photoUrl ? <img src={photoUrl} alt="" onError={() => { storeProfilePhoto(account.id, null); setPhotoUrl(null); }} /> : <span style={{ background: colors?.backgroundColor, color: colors?.color }}>{profileAvatarMark(account) ?? <ProfileUserIcon />}</span>}
              </button>
              {phase === 'idle' && (account.hasProfilePhoto || photoUrl) ? (
                <button type="button" className="profile-remove" aria-label="Remove photo" onClick={() => setRemoveOpen(true)}>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path fill="currentColor" d="M9 3h6v1h5v2h-1v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6H4V4h5V3Zm-2 3v13h10V6H7Zm2 2h2v9H9V8Zm4 0h2v9h-2V8Z" />
                  </svg>
                </button>
              ) : null}
              <input ref={fileInput} className="profile-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void changePhoto(event.target.files?.[0]); event.target.value = ''; }} />
            </div>
            <div className="profile-settings">
              {contactRows.map((row) => (
                <div key={row.label}>
                  {row.action === 'appearance' ? (
                    <button type="button" className="profile-row" onClick={() => setAppearanceOpen(true)}>
                      <MoreRowIcon kind="appearance" /><span><small>{row.label}</small><strong>{row.value}</strong></span>
                      <span aria-hidden="true" className="profile-chevron">
                        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                          <path fill="currentColor" d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41Z" />
                        </svg>
                      </span>
                    </button>
                  ) : (
                    <div className="profile-row">
                      <MoreRowIcon kind="phone" /><span><small>{row.label}</small><strong>{row.value}</strong></span>
                    </div>
                  )}
                </div>
              ))}
              <Link className="profile-row profile-addresses" to="/addresses"><MoreRowIcon kind="address" /><span><strong>Address Book</strong></span><span aria-hidden="true" className="more-address-chevron">›</span></Link>
              {appearanceRows.map((row) => (
                <div key={row.label}>
                      <button type="button" className="profile-row" onClick={() => setAppearanceOpen(true)}>
                    <MoreRowIcon kind="appearance" /><span><small>{row.label}</small><strong>{row.value}</strong></span>
                    <span aria-hidden="true" className="profile-chevron"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41Z" /></svg></span>
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : isLoading ? null : <h1>More</h1>}
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        {photoError ? <ErrorMessage>{photoError}</ErrorMessage> : null}
        <button type="button" className="profile-logout" disabled={isSigningOut} onClick={() => { void handleSignOut(); }}>
          <MoreRowIcon kind="logout" />{isSigningOut ? 'Signing out' : 'Log out'}
        </button>
      </div>
      {removeMotion.mounted ? (
        <div className={motionClass('confirm-dialog-backdrop', 'dialog', removeMotion.visible)} onClick={() => setRemoveOpen(false)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-photo-title" aria-describedby="remove-photo-copy" onClick={(event) => event.stopPropagation()}>
            <h2 id="remove-photo-title">Remove profile photo?</h2>
            <p id="remove-photo-copy">Your initials will be shown instead.</p>
            <div className="confirm-dialog-actions">
              <button type="button" className="confirm-keep" onClick={() => setRemoveOpen(false)}>Keep photo</button>
              <button type="button" className="confirm-cancel" onClick={() => { void removePhoto(); }}>Remove photo</button>
            </div>
          </div>
        </div>
      ) : null}
      {appearanceMotion.mounted ? (
        <div className={motionClass('profile-sheet-backdrop', 'sheet', appearanceMotion.visible)} onClick={() => setAppearanceOpen(false)}>
          <div className="profile-appearance" role="dialog" aria-modal="true" aria-label="Appearance" onClick={(event) => event.stopPropagation()}>
            <h2>Appearance</h2>
            <div role="radiogroup">
              {APPEARANCE_OPTIONS.map((option) => {
                const selected = option === mode;
                return (
                  <button key={option} type="button" role="radio" aria-checked={selected} className={selected ? 'is-selected' : undefined} onClick={() => { setMode(option); setAppearanceOpen(false); }}>
                    <span>{appearanceLabel(option)}</span>
                    <span className="profile-radio" aria-hidden="true">
                      {selected ? (
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                          <path d="M5 12.5 9.2 17 19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ProfileUserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.2" fill="currentColor" />
      <path fill="currentColor" d="M5.5 18.5c.7-3 2.9-4.5 6.5-4.5s5.8 1.5 6.5 4.5H5.5Z" />
    </svg>
  );
}

async function photoObjectUrl(token: string): Promise<string | null> {
  try {
    const blob = await loadProfilePhoto(token);
    return blob ? URL.createObjectURL(blob) : null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    if (isSessionRejection(error)) throw error;
    return null;
  }
}
