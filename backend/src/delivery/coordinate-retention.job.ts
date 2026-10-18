import { Logger } from '@nestjs/common';
import type { RetentionRunResult } from './coordinate-retention.js';
import { CoordinateRetentionService } from './coordinate-retention.service.js';

export type RetentionWorkerContext = {
  get(token: typeof CoordinateRetentionService): Pick<CoordinateRetentionService, 'run'>;
  close(): Promise<void>;
};

export type RetentionWorkerStatus = RetentionRunResult['status'] | 'failed' | 'shutdown-failed';

export type RetentionWorkerRecord = {
  event: 'coordinate-retention';
  status: RetentionWorkerStatus;
  refreshed?: number;
  cleared?: number;
  refreshFailed?: number;
  googlePlacesConfigured: boolean;
  error?: string;
};

export function googlePlacesConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.GOOGLE_MAPS_API_KEY?.trim());
}

export function retentionWorkerExitCode(status: RetentionWorkerStatus): number {
  return status === 'finished' || status === 'locked' || status === 'overlap' ? 0 : 1;
}

export function retentionWorkerRecord(result: RetentionRunResult, configured: boolean): RetentionWorkerRecord {
  return {
    event: 'coordinate-retention',
    status: result.status,
    refreshed: result.refreshed,
    cleared: result.cleared,
    refreshFailed: result.refreshFailed,
    googlePlacesConfigured: configured,
  };
}

function failureRecord(status: 'failed' | 'shutdown-failed', error: unknown, configured: boolean): RetentionWorkerRecord {
  return {
    event: 'coordinate-retention',
    status,
    googlePlacesConfigured: configured,
    error: error instanceof Error ? error.name : 'Error',
  };
}

function defaultEmit(record: RetentionWorkerRecord): void {
  const logger = new Logger('CoordinateRetentionJob');
  const line = JSON.stringify(record);
  if (retentionWorkerExitCode(record.status) === 0) {
    logger.log(line);
    return;
  }
  logger.error(line);
}

export async function executeCoordinateRetentionWorker(options: {
  createContext: () => Promise<RetentionWorkerContext>;
  emit?: (record: RetentionWorkerRecord) => void;
  env?: NodeJS.ProcessEnv;
}): Promise<number> {
  const emit = options.emit ?? defaultEmit;
  const configured = googlePlacesConfigured(options.env ?? process.env);
  let context: RetentionWorkerContext | undefined;
  let code = 1;
  try {
    context = await options.createContext();
    const result = await context.get(CoordinateRetentionService).run();
    emit(retentionWorkerRecord(result, configured));
    code = retentionWorkerExitCode(result.status);
  } catch (error) {
    emit(failureRecord('failed', error, configured));
    code = 1;
  }
  if (context) {
    try {
      await context.close();
    } catch (error) {
      emit(failureRecord('shutdown-failed', error, configured));
      code = 1;
    }
  }
  return code;
}
