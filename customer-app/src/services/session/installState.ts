export type InstallDecision = 'continue' | 'establish' | 'reinstall';

export function decideInstall(input: {
  sandboxAvailable: boolean;
  sandboxMarker: string | null;
  keychainMarker: string | null;
}): InstallDecision {
  if (!input.sandboxAvailable) {
    return 'continue';
  }
  const sandbox = normalizeMarker(input.sandboxMarker);
  const keychain = normalizeMarker(input.keychainMarker);
  if (sandbox && sandbox === keychain) {
    return 'continue';
  }
  if (!sandbox && keychain) {
    return 'reinstall';
  }
  if (sandbox && keychain && sandbox !== keychain) {
    return 'reinstall';
  }
  return 'establish';
}

function normalizeMarker(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
