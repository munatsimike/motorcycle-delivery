import { loadRegistrationDestination } from '../features/auth/data/registrationRecoveryStore';
import { navigationRef } from './navigationRef';

export async function openRestoredRegistration(now = Date.now()): Promise<void> {
  if (!navigationRef.isReady()) {
    return;
  }
  const destination = await loadRegistrationDestination(now);
  if (destination.kind !== 'form' || !navigationRef.isReady()) {
    return;
  }
  navigationRef.navigate('CompleteRegistration', {
    registrationToken: destination.registrationToken,
    fullName: destination.fullName || undefined,
    address: destination.address || undefined,
  });
}
