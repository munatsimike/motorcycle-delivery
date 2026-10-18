import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';
import { databasePoolConfig, describeDatabaseError } from './database-connection.js';

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

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg(
      databasePoolConfig(loadDatabaseUrl(), process.env.DATABASE_SSL_CA),
      {
        onPoolError: (error) => {
          logger.error(describeDatabaseError(error, 'PostgreSQL pool reported a connection error'));
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
      logger.error(describeDatabaseError(error, 'Database connectivity check failed'));
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
