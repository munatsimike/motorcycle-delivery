import { describe, expect, it } from 'vitest';

import { LocationUploadCoordinator, SharingPausedError } from './locationUpload';
import { LOCATION_UPLOAD_INTERVAL_MS } from './locationUpload';
import type { GpsFix } from './gpsFix';

const fix: GpsFix = { latitude: -17.8292, longitude: 31.0522 };

describe('location upload coordinator', () => {
  it('uploads a real fix once when the callback and the freshness check overlap', async () => {
    let release: () => void = () => undefined;
    const send = () => new Promise<void>((resolve) => {
      release = resolve;
    });
    const coordinator = new LocationUploadCoordinator(() => 1_000);
    coordinator.arm();

    const first = coordinator.submit(fix, 1_000, send);
    const second = coordinator.flush(1_000, send);
    release();
    await expect(first).resolves.toBe('uploaded');
    await expect(second).resolves.toBe('joined');
  });

  it('waits for the interval before sending the same fix again', async () => {
    const sent: GpsFix[] = [];
    const coordinator = new LocationUploadCoordinator(() => 0);
    coordinator.arm();
    const send = async (point: GpsFix) => {
      sent.push(point);
    };

    await expect(coordinator.submit(fix, 0, send)).resolves.toBe('uploaded');
    await expect(coordinator.flush(LOCATION_UPLOAD_INTERVAL_MS - 1, send)).resolves.toBe('waiting');
    await expect(coordinator.flush(LOCATION_UPLOAD_INTERVAL_MS, send)).resolves.toBe('uploaded');
    expect(sent).toEqual([fix, fix]);
  });

  it('does not upload when no device fix has arrived', async () => {
    const coordinator = new LocationUploadCoordinator(() => 0);
    coordinator.arm();
    const send = async () => {
      throw new Error('should not send');
    };

    await expect(coordinator.flush(0, send)).resolves.toBe('no-fix');
  });

  it('retries after a network failure without treating the failed attempt as fresh', async () => {
    const coordinator = new LocationUploadCoordinator(() => 5_000);
    coordinator.arm();
    let calls = 0;
    const send = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('network');
      }
    };

    await expect(coordinator.submit(fix, 5_000, send)).resolves.toBe('failed');
    await expect(coordinator.flush(5_000, send)).resolves.toBe('uploaded');
    expect(calls).toBe(2);
  });

  it('stops when sharing is paused and ignores later fixes', async () => {
    const coordinator = new LocationUploadCoordinator(() => 0);
    coordinator.arm();
    const send = async () => {
      throw new SharingPausedError();
    };

    await expect(coordinator.submit(fix, 0, send)).resolves.toBe('paused');
    coordinator.close();
    await expect(coordinator.submit({ latitude: 1, longitude: 2 }, 30_000, async () => undefined)).resolves.toBe('paused');
  });
});
