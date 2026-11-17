import { ExchangeRateService } from './exchange-rate.service.js';

const NOW = new Date('2026-11-16T22:00:00.000Z');
const ADMIN = { userId: 'admin-1' };

describe('ExchangeRateService', () => {
  it('publishes a new version and an audit without rewriting the previous row into the new rate', async () => {
    const rates = [{ id: 'rate-1', rateVersion: 1, zigPerUsd: '33.0000', isActive: true, createdById: null, createdAt: NOW }];
    const audits: Array<Record<string, unknown>> = [];
    const tx = {
      async $queryRaw() {
        return [];
      },
      exchangeRate: {
        async findFirst(args?: { where?: { isActive?: boolean }; orderBy?: { rateVersion?: 'desc' } }) {
          if (args?.orderBy?.rateVersion === 'desc') {
            return [...rates].sort((left, right) => right.rateVersion - left.rateVersion)[0] ?? null;
          }
          return rates.find((row) => row.isActive) ?? null;
        },
        async update({ where, data }: { where: { id: string }; data: { isActive: boolean } }) {
          const row = rates.find((item) => item.id === where.id);
          if (!row) throw new Error('missing rate');
          row.isActive = data.isActive;
          return row;
        },
        async create({ data }: { data: Record<string, unknown> }) {
          const row = { id: 'rate-2', ...data };
          rates.push(row as typeof rates[number]);
          return row;
        },
      },
      exchangeRateAudit: {
        async create({ data }: { data: Record<string, unknown> }) {
          audits.push(data);
          return data;
        },
      },
    };
    const prisma = {
      async $transaction<T>(callback: (client: typeof tx) => Promise<T>) {
        return callback(tx);
      },
      exchangeRateAudit: {
        async count() {
          return audits.length;
        },
        async findMany() {
          return audits.map((audit, index) => ({
            id: `audit-${index}`,
            ...audit,
            actor: { fullName: 'Ada Admin' },
          }));
        },
      },
    };
    const service = new ExchangeRateService(prisma as never);
    const same = await service.publish(ADMIN, { zigPerUsd: '33.0000' }, NOW);
    expect(same.rateVersion).toBe(1);
    expect(audits).toHaveLength(0);
    const next = await service.publish(ADMIN, { zigPerUsd: '34.5000' }, NOW);
    expect(next).toMatchObject({ rateVersion: 2, zigPerUsd: '34.5000', createdById: 'admin-1' });
    expect(rates[0]).toMatchObject({ rateVersion: 1, zigPerUsd: '33.0000', isActive: false });
    expect(audits[0]).toMatchObject({
      actorId: 'admin-1',
      previousVersion: 1,
      nextVersion: 2,
      previousZigPerUsd: '33.0000',
      nextZigPerUsd: '34.5000',
    });
    const history = await service.audits({});
    expect(history.data[0]).toMatchObject({ actorName: 'Ada Admin', previousZigPerUsd: '33.0000', nextZigPerUsd: '34.5000' });
  });
});
