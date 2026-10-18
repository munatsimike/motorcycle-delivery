import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DispatchWorker } from './dispatch.worker.js';
import { CoordinateRetentionWorker } from './coordinate-retention.worker.js';
import type { RetentionRunResult } from './coordinate-retention.js';
import { CoordinateRetentionService } from './coordinate-retention.service.js';
import {
  executeCoordinateRetentionWorker,
  googlePlacesConfigured,
  retentionWorkerExitCode,
  retentionWorkerRecord,
  type RetentionWorkerContext,
  type RetentionWorkerRecord,
} from './coordinate-retention.job.js';
import { CoordinateRetentionJobModule } from './coordinate-retention.job.module.js';
import { isCoordinateRetentionEntry } from './coordinate-retention.main.js';
import { PrismaModule } from '../prisma/prisma.module.js';

const SECRET_KEY = 'test-maps-key-do-not-log';

function context(
  run: () => Promise<RetentionRunResult>,
  close: () => Promise<void> = async () => undefined,
): RetentionWorkerContext {
  return {
    get: () => ({ run }),
    close,
  };
}

describe('coordinate retention job', () => {
  it('reports a finished pass and closes the context', async () => {
    const records: RetentionWorkerRecord[] = [];
    let closed = false;
    const code = await executeCoordinateRetentionWorker({
      env: { GOOGLE_MAPS_API_KEY: SECRET_KEY },
      emit: (record) => records.push(record),
      createContext: async () => context(async () => ({
        status: 'finished',
        refreshed: 1,
        cleared: 2,
        refreshFailed: 0,
      }), async () => {
        closed = true;
      }),
    });
    expect(code).toBe(0);
    expect(closed).toBe(true);
    expect(records).toEqual([{
      event: 'coordinate-retention',
      status: 'finished',
      refreshed: 1,
      cleared: 2,
      refreshFailed: 0,
      googlePlacesConfigured: true,
    }]);
    expect(JSON.stringify(records)).not.toContain(SECRET_KEY);
  });

  it('exits nonzero when the pass throws and still closes the context', async () => {
    const records: RetentionWorkerRecord[] = [];
    let closed = false;
    const code = await executeCoordinateRetentionWorker({
      env: { GOOGLE_MAPS_API_KEY: SECRET_KEY },
      emit: (record) => records.push(record),
      createContext: async () => context(async () => {
        throw new Error(`database ${SECRET_KEY} postgresql://user:password@localhost/db`);
      }, async () => {
        closed = true;
      }),
    });
    expect(code).toBe(1);
    expect(closed).toBe(true);
    expect(records).toEqual([{
      event: 'coordinate-retention',
      status: 'failed',
      googlePlacesConfigured: true,
      error: 'Error',
    }]);
    expect(JSON.stringify(records)).not.toContain(SECRET_KEY);
    expect(JSON.stringify(records)).not.toContain('postgresql://');
  });

  it('treats a held database lease as a completed overlap', async () => {
    const records: RetentionWorkerRecord[] = [];
    const closes: string[] = [];
    let held = false;
    async function run() {
      if (held) {
        return { status: 'locked' as const, refreshed: 0, cleared: 0, refreshFailed: 0 };
      }
      held = true;
      await new Promise((resolve) => setTimeout(resolve, 20));
      held = false;
      return { status: 'finished' as const, refreshed: 0, cleared: 0, refreshFailed: 0 };
    }
    const [first, second] = await Promise.all([
      executeCoordinateRetentionWorker({
        env: {},
        emit: (record) => records.push(record),
        createContext: async () => context(run, async () => {
          closes.push('first');
        }),
      }),
      executeCoordinateRetentionWorker({
        env: {},
        emit: (record) => records.push(record),
        createContext: async () => context(run, async () => {
          closes.push('second');
        }),
      }),
    ]);
    expect([first, second].sort()).toEqual([0, 0]);
    expect(closes.sort()).toEqual(['first', 'second']);
    expect(records.map((record) => record.status).sort()).toEqual(['finished', 'locked']);
    expect(records.every((record) => record.googlePlacesConfigured === false)).toBe(true);
  });

  it('exits nonzero when the lease is lost and when shutdown fails', async () => {
    const lost = await executeCoordinateRetentionWorker({
      emit: () => undefined,
      createContext: async () => context(async () => ({
        status: 'lost-lease',
        refreshed: 0,
        cleared: 0,
        refreshFailed: 0,
      })),
    });
    expect(lost).toBe(1);
    const records: RetentionWorkerRecord[] = [];
    const shutdown = await executeCoordinateRetentionWorker({
      emit: (record) => records.push(record),
      createContext: async () => context(async () => ({
        status: 'finished',
        refreshed: 0,
        cleared: 0,
        refreshFailed: 0,
      }), async () => {
        throw new TypeError('pool did not end');
      }),
    });
    expect(shutdown).toBe(1);
    expect(records.map((record) => record.status)).toEqual(['finished', 'shutdown-failed']);
    expect(records[1]?.error).toBe('TypeError');
    expect(JSON.stringify(records)).not.toContain('pool did not end');
  });

  it('keeps the job module limited to the existing retention service', () => {
    expect(Reflect.getMetadata('imports', CoordinateRetentionJobModule)).toEqual([PrismaModule]);
    expect(Reflect.getMetadata('providers', CoordinateRetentionJobModule)).toEqual([CoordinateRetentionService]);
    expect(Reflect.getMetadata('controllers', CoordinateRetentionJobModule) ?? []).toEqual([]);
    const providers = Reflect.getMetadata('providers', CoordinateRetentionJobModule) as unknown[];
    expect(providers).not.toContain(DispatchWorker);
    expect(providers).not.toContain(CoordinateRetentionWorker);
  });

  it('starts an application context only when this file is the process entry', () => {
    const main = readFileSync(new URL('./coordinate-retention.main.ts', import.meta.url), 'utf8');
    const job = readFileSync(new URL('./coordinate-retention.job.ts', import.meta.url), 'utf8');
    expect(main).toContain('createApplicationContext');
    expect(main).not.toContain('.listen(');
    expect(main).not.toContain('DispatchWorker');
    expect(job).not.toContain('clearCoordinates');
    expect(job).not.toContain('runRetention(');
    expect(isCoordinateRetentionEntry(undefined, 'file:///worker.js')).toBe(false);
    expect(isCoordinateRetentionEntry('C:\\app\\coordinate-retention.main.js', 'file:///C:/app/coordinate-retention.main.js')).toBe(true);
    expect(retentionWorkerExitCode('overlap')).toBe(0);
    expect(retentionWorkerExitCode('lost-lease')).toBe(1);
    expect(googlePlacesConfigured({ GOOGLE_MAPS_API_KEY: '  ' })).toBe(false);
    expect(retentionWorkerRecord({
      status: 'finished',
      refreshed: 0,
      cleared: 0,
      refreshFailed: 0,
    }, true).googlePlacesConfigured).toBe(true);
  });

  it('does not place the Google Places key in the customer app', async () => {
    const root = join(import.meta.dirname, '../../../customer-app');
    const hits: string[] = [];
    async function walk(directory: string): Promise<void> {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.expo') {
          continue;
        }
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (!/\.(ts|tsx|js|json|env|example)$/.test(entry.name)) {
          continue;
        }
        const text = readFileSync(path, 'utf8');
        if (text.includes('GOOGLE_MAPS_API_KEY') || text.includes('X-Goog-Api-Key')) {
          hits.push(path);
        }
      }
    }
    await walk(root);
    expect(hits).toEqual([]);
  });
});
