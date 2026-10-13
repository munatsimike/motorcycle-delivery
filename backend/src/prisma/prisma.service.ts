import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';

const logger = new Logger('PrismaService');

function loadDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) {
    const candidates = [
      resolve(process.cwd(), '.env'),
      resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'),
    ];

    for (const envFile of candidates) {
      if (!existsSync(envFile)) {
        continue;
      }

      process.loadEnvFile(envFile);
      break;
    }
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  return databaseUrl;
}

function failureMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) {
      return `Database connectivity check failed (${code})`;
    }
  }

  return 'Database connectivity check failed';
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg(
      { connectionString: loadDatabaseUrl() },
      {
        onPoolError: () => {
          logger.error('PostgreSQL pool reported a connection error');
        },
      },
    );

    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      await this.verifyConnectivity();
    } catch (error) {
      logger.error(failureMessage(error));
      throw new Error('Database connectivity check failed');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async verifyConnectivity(): Promise<void> {
    const rows = await this.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error('Database connectivity check failed');
    }

    logger.log('Database connectivity check succeeded');
  }
}
