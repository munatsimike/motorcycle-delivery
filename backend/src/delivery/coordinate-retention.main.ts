import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { loadBackendEnv } from '../load-env.js';
import { executeCoordinateRetentionWorker, type RetentionWorkerContext } from './coordinate-retention.job.js';
import { CoordinateRetentionJobModule } from './coordinate-retention.job.module.js';

// One-shot retention process. It does not listen for HTTP and does not start
// dispatch or other background jobs. Run it once per invocation. Schedule that
// command hourly, and run it once immediately after an outage before resuming
// the hourly schedule. Leave COORDINATE_RETENTION_ENABLED=false on the API so
// this process stays the only scheduler. The database lease skips an overlap.

loadBackendEnv();

export function isCoordinateRetentionEntry(entry: string | undefined, moduleUrl: string): boolean {
  if (!entry) {
    return false;
  }
  return moduleUrl === pathToFileURL(resolve(entry)).href;
}

export async function createCoordinateRetentionContext(): Promise<RetentionWorkerContext> {
  const app = await NestFactory.createApplicationContext(CoordinateRetentionJobModule, {
    logger: ['error', 'log', 'warn'],
  });
  app.enableShutdownHooks();
  return {
    get: (token) => app.get(token),
    close: () => app.close(),
  };
}

if (isCoordinateRetentionEntry(process.argv[1], import.meta.url)) {
  process.exitCode = await executeCoordinateRetentionWorker({
    createContext: createCoordinateRetentionContext,
  });
}
