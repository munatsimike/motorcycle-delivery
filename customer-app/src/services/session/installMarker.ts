import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { decideInstall, type InstallDecision } from './installState';

const INSTALL_KEY = 'riders.customer.install';
const INSTALL_FILE = 'riders-install-id';

const installOptions = {
  keychainService: 'riders.customer.install',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function reconcileInstallMarker(): Promise<InstallDecision> {
  const sandbox = readSandboxMarker();
  let keychainMarker: string | null = null;
  try {
    keychainMarker = await SecureStore.getItemAsync(INSTALL_KEY, installOptions);
  } catch {
    keychainMarker = null;
  }
  const decision = decideInstall({
    sandboxAvailable: sandbox.available,
    sandboxMarker: sandbox.value,
    keychainMarker,
  });
  if (decision === 'continue') {
    return decision;
  }
  const nextId = decision === 'establish' && sandbox.value ? sandbox.value : newInstallId();
  if (sandbox.available) {
    writeSandboxMarker(nextId);
  }
  try {
    await SecureStore.setItemAsync(INSTALL_KEY, nextId, installOptions);
  } catch {
    // A missing keychain marker keeps the next launch in the establish path.
  }
  return decision;
}

function readSandboxMarker(): { available: boolean; value: string | null } {
  try {
    const file = new File(Paths.document, INSTALL_FILE);
    if (!file.exists) {
      return { available: true, value: null };
    }
    const value = file.textSync().trim();
    return { available: true, value: value.length > 0 ? value : null };
  } catch {
    return { available: false, value: null };
  }
}

function writeSandboxMarker(value: string) {
  const file = new File(Paths.document, INSTALL_FILE);
  file.write(value);
}

function newInstallId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
