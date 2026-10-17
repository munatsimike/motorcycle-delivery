import { isUnauthorized } from '../auth/domain/apiError';
import { SessionExpiredError } from '../auth/domain/sessionGate';
import { riderSessionGate } from '../auth/riderSessionGate';
import { riderOnboardingRepository } from '../onboarding/data/RiderOnboardingApiRepository';
import { loadRiderOnboarding } from '../onboarding/domain/loadRiderOnboarding';
import type { RiderAvailability, RiderOnboarding } from '../onboarding/domain/riderOnboarding';
import {
  goOffline,
  goOnline,
  OFFLINE_UNCONFIRMED,
  type AvailabilityCommandResult,
} from './domain/availabilityCommands';
import { readLatestTaskFix, type GpsFix } from './domain/gpsFix';
import {
  LOCATION_UPLOAD_INTERVAL_MS,
  LocationUploadCoordinator,
  SharingPausedError,
  type UploadOutcome,
} from './domain/locationUpload';
import { locationStatusCopy, type LocationAccess } from './domain/locationStatus';
import { sharingStep } from './domain/sharingPolicy';
import { riderAvailabilityRepository } from './data/RiderAvailabilityApiRepository';
import { expoRiderLocation } from './data/expoRiderLocation';
import { locationSharingFlag } from './data/locationSharingFlag';

const LOCATION_DELAYED = 'Location update delayed. Check your connection. Sharing will retry.';

export type SharingSnapshot = {
  sharing: boolean;
  access: LocationAccess | 'unknown';
  notice: string | null;
};

type Listener = () => void;

class RiderLocationSharing {
  private readonly coordinator = new LocationUploadCoordinator();
  private readonly listeners = new Set<Listener>();
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private appForeground = false;
  private offlineUnconfirmed = false;
  private serverAvailability: RiderAvailability | null = null;
  private serverChanged = false;
  private sessionExpired = false;
  private reconciledStop = false;
  private access: LocationAccess | 'unknown' = 'unknown';
  private notice: string | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): SharingSnapshot {
    return {
      sharing: this.active,
      access: this.access,
      notice: this.notice,
    };
  }

  consumeServerChange(): boolean {
    const changed = this.serverChanged;
    this.serverChanged = false;
    return changed;
  }

  consumeSessionExpired(): boolean {
    const expired = this.sessionExpired;
    this.sessionExpired = false;
    return expired;
  }

  setAppForeground(foreground: boolean): void {
    this.appForeground = foreground;
    if (foreground) {
      void this.ensureSharing();
    }
  }

  applyServerAvailability(availability: RiderAvailability): Promise<void> {
    this.serverAvailability = availability;
    if (availability === 'OFFLINE') {
      this.offlineUnconfirmed = false;
    }
    return this.ensureSharing();
  }

  probe(): Promise<void> {
    return this.readAccess();
  }

  goOnline(onboarding: RiderOnboarding): Promise<AvailabilityCommandResult> {
    return this.enqueue(async () => {
      this.offlineUnconfirmed = false;
      const result = await goOnline(
        onboarding,
        riderSessionGate,
        riderAvailabilityRepository,
        expoRiderLocation,
        {
          uploadNow: (fix) => this.uploadNow(fix),
          start: () => this.markStarted(),
          stop: () => this.stopUpdates(),
        },
      );
      if (result.status === 'online') {
        this.serverAvailability = 'AVAILABLE';
        this.notice = null;
        this.serverChanged = true;
      } else if (result.status === 'unconfirmed') {
        this.offlineUnconfirmed = true;
        this.notice = result.message;
      } else if (result.status === 'location') {
        this.access = result.access;
        this.notice = result.message;
      } else if (result.status !== 'blocked') {
        this.notice = result.message || null;
      }
      this.emit();
      return result;
    });
  }

  goOffline(onboarding: RiderOnboarding): Promise<AvailabilityCommandResult> {
    return this.enqueue(async () => {
      const result = await goOffline(
        onboarding,
        riderSessionGate,
        riderAvailabilityRepository,
        {
          uploadNow: async () => undefined,
          start: async () => undefined,
          stop: () => this.stopUpdates(),
        },
      );
      if (result.status === 'offline' && result.availability === 'OFFLINE') {
        this.offlineUnconfirmed = false;
        this.serverAvailability = 'OFFLINE';
        this.notice = null;
        this.serverChanged = true;
      } else if (result.status === 'unconfirmed') {
        this.offlineUnconfirmed = true;
        this.notice = result.message;
      } else if (result.status === 'offline') {
        this.serverAvailability = result.availability;
        this.notice = result.message || null;
        this.serverChanged = true;
      }
      this.emit();
      return result;
    });
  }

  async prepareForSignOut(): Promise<void> {
    await this.enqueue(async () => {
      const shouldOffline = this.active
        || this.serverAvailability === 'AVAILABLE'
        || await locationSharingFlag.load().catch(() => false);
      await this.stopUpdates();
      if (!shouldOffline) {
        return;
      }
      try {
        await riderSessionGate.authorized((accessToken) => riderAvailabilityRepository.offline(accessToken));
      } catch {
        // A failed sign-out request still ends the local session. The 60-second
        // freshness rule removes the rider from nearby results.
      }
    });
  }

  async stopForSignOut(): Promise<void> {
    await this.enqueue(() => this.stopUpdates());
  }

  async onTaskLocations(data: unknown): Promise<void> {
    const fix = readLatestTaskFix(data);
    if (!fix) {
      return;
    }
    if (!this.coordinator.isAccepting()) {
      const enabled = await locationSharingFlag.load().catch(() => false);
      if (!enabled || this.offlineUnconfirmed) {
        return;
      }
      this.coordinator.arm();
      this.active = true;
      this.serverAvailability = 'AVAILABLE';
      this.armTimer();
      this.emit();
    }
    await this.publish(fix, Date.now(), true);
  }

  async onTaskError(): Promise<void> {
    await this.readAccess();
    if (this.access !== 'granted' && this.access !== 'unknown') {
      await this.enqueue(() => this.loseLocation(this.access as LocationAccess));
    }
  }

  openLocationSettings(): Promise<void> {
    return expoRiderLocation.openLocationSettings();
  }

  openAppSettings(): Promise<void> {
    return expoRiderLocation.openAppSettings();
  }

  private async ensureSharing(): Promise<void> {
    await this.enqueue(async () => {
      const server = this.serverAvailability;
      if (!server) {
        return;
      }
      const step = sharingStep({
        server,
        sharing: this.active,
        appForeground: this.appForeground,
      });
      if (step === 'stop') {
        if (this.active || !this.reconciledStop) {
          this.reconciledStop = true;
          await this.stopUpdates();
          this.emit();
        }
        return;
      }
      this.reconciledStop = true;
      if (step !== 'resume' || this.offlineUnconfirmed) {
        return;
      }
      await this.resume();
    });
  }

  private async resume(): Promise<void> {
    await this.readAccess();
    if (this.access !== 'granted') {
      await this.loseLocation(this.access as LocationAccess);
      return;
    }
    const fix = await expoRiderLocation.readCurrent();
    if (!fix) {
      this.access = 'position-unavailable';
      this.notice = locationStatusCopy('position-unavailable', false).detail;
      this.emit();
      return;
    }
    try {
      await this.uploadNow(fix);
      await this.markStarted();
      this.notice = null;
      this.emit();
    } catch {
      await this.stopUpdates();
      await this.rollbackAfterFailedShare();
    }
  }

  private async uploadNow(fix: GpsFix): Promise<void> {
    this.coordinator.arm();
    const outcome = await this.coordinator.submit(fix, Date.now(), (point) => this.sendPoint(point));
    if (outcome !== 'uploaded') {
      this.coordinator.close();
      throw new Error('Your location could not be shared. Check your connection and try again.');
    }
  }

  private async markStarted(): Promise<void> {
    await locationSharingFlag.save(true);
    try {
      await expoRiderLocation.startUpdates();
    } catch (error) {
      await locationSharingFlag.save(false).catch(() => undefined);
      throw error;
    }
    this.active = true;
    this.serverAvailability = 'AVAILABLE';
    this.armTimer();
  }

  private async publish(fix: GpsFix | null, now: number, reconcile: boolean): Promise<UploadOutcome> {
    if (fix) {
      this.coordinator.remember(fix);
    }
    const outcome = await this.coordinator.flush(now, (point) => (
      reconcile ? this.sendPointIfStillOnline(point) : this.sendPoint(point)
    ));
    if (outcome === 'paused') {
      if (this.sessionExpired) {
        await this.stopUpdates();
        this.emit();
        return outcome;
      }
      await this.stopUpdates();
      this.serverChanged = true;
      this.emit();
      return outcome;
    }
    if (outcome === 'failed') {
      if (this.sessionExpired) {
        await this.stopUpdates();
      } else {
        this.notice = LOCATION_DELAYED;
      }
      this.emit();
      return outcome;
    }
    if (outcome === 'uploaded') {
      this.notice = this.offlineUnconfirmed ? this.notice : null;
      this.emit();
    }
    return outcome;
  }

  private async sendPoint(fix: GpsFix): Promise<void> {
    try {
      await riderSessionGate.authorized((accessToken) => riderAvailabilityRepository.uploadLocation(accessToken, fix));
    } catch (error) {
      this.captureSessionLoss(error);
      throw error;
    }
  }

  private async sendPointIfStillOnline(fix: GpsFix): Promise<void> {
    try {
      const onboarding = await loadRiderOnboarding(riderSessionGate, riderOnboardingRepository);
      if (onboarding.availability !== this.serverAvailability) {
        this.serverAvailability = onboarding.availability;
        this.serverChanged = true;
      }
      if (onboarding.availability !== 'AVAILABLE') {
        throw new SharingPausedError();
      }
      await this.sendPoint(fix);
    } catch (error) {
      this.captureSessionLoss(error);
      throw error;
    }
  }

  private captureSessionLoss(error: unknown): void {
    if (error instanceof SessionExpiredError || isUnauthorized(error)) {
      this.sessionExpired = true;
    }
  }

  private async tick(): Promise<void> {
    if (!this.active || this.offlineUnconfirmed) {
      return;
    }
    await this.readAccess();
    if (this.access !== 'granted') {
      await this.enqueue(() => this.loseLocation(this.access as LocationAccess));
      return;
    }
    const outcome = await this.publish(null, Date.now(), true);
    if (outcome === 'no-fix') {
      const fix = await expoRiderLocation.readCurrent();
      if (fix) {
        await this.publish(fix, Date.now(), true);
      }
    }
  }

  private async loseLocation(access: LocationAccess): Promise<void> {
    await this.stopUpdates();
    this.access = access;
    const detail = locationStatusCopy(access, false).detail;
    try {
      const offline = await riderSessionGate.authorized((accessToken) => riderAvailabilityRepository.offline(accessToken));
      this.serverAvailability = offline.availability;
      this.serverChanged = true;
      if (offline.availability === 'OFFLINE') {
        this.offlineUnconfirmed = false;
        this.notice = detail;
      } else {
        this.offlineUnconfirmed = true;
        this.notice = `${detail} ${OFFLINE_UNCONFIRMED}`;
      }
    } catch (error) {
      this.captureSessionLoss(error);
      this.offlineUnconfirmed = true;
      this.notice = `${detail} ${OFFLINE_UNCONFIRMED}`;
    }
    this.emit();
  }

  private async rollbackAfterFailedShare(): Promise<void> {
    try {
      const offline = await riderSessionGate.authorized((accessToken) => riderAvailabilityRepository.offline(accessToken));
      this.serverAvailability = offline.availability;
      this.serverChanged = true;
      this.offlineUnconfirmed = offline.availability !== 'OFFLINE';
      this.notice = offline.availability === 'OFFLINE'
        ? 'Your location could not be shared. Check your connection and try again.'
        : `${offline.message ?? 'Your location could not be shared.'} ${OFFLINE_UNCONFIRMED}`;
    } catch {
      this.offlineUnconfirmed = true;
      this.notice = `Your location could not be shared. Check your connection and try again. ${OFFLINE_UNCONFIRMED}`;
    }
    this.emit();
  }

  private async readAccess(): Promise<void> {
    try {
      this.access = await expoRiderLocation.access();
    } catch {
      this.access = 'position-unavailable';
    }
    this.emit();
  }

  private async stopUpdates(): Promise<void> {
    this.active = false;
    this.disarmTimer();
    this.coordinator.close();
    await expoRiderLocation.stopUpdates().catch(() => undefined);
    await locationSharingFlag.save(false).catch(() => undefined);
  }

  private armTimer(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, LOCATION_UPLOAD_INTERVAL_MS);
  }

  private disarmTimer(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const riderLocationSharing = new RiderLocationSharing();
