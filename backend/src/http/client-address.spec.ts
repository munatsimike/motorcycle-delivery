import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CoordinateRetentionWorker } from '../delivery/coordinate-retention.worker.js';
import { DispatchWorker } from '../delivery/dispatch.worker.js';
import { retentionSchedule } from '../delivery/coordinate-retention.js';
import { RiderModule } from '../rider/rider.module.js';
import {
  railwayEdgeClientIpEnabled,
  rateLimitAddress,
  resolveClientAddress,
  trustedProxyCidrs,
} from './client-address.js';

const proxies = ['10.0.0.0/8'];

describe('OTP client address', () => {
  it('ignores forwarded headers from a direct client', () => {
    expect(resolveClientAddress({
      socketAddress: '203.0.113.10',
      forwardedFor: '198.51.100.20, 203.0.113.10',
      realIp: '198.51.100.20',
      trustedProxyCidrs: proxies,
    })).toBe('203.0.113.10');
    expect(rateLimitAddress({
      socket: { remoteAddress: '127.0.0.1' },
      headers: {
        'x-forwarded-for': '198.51.100.20',
        'x-real-ip': '198.51.100.20',
      },
    }, '10.0.0.0/8')).toBe('127.0.0.1');
  });

  it('uses the proxy-asserted address and not a client-supplied prefix', () => {
    expect(resolveClientAddress({
      socketAddress: '::ffff:10.1.2.3',
      forwardedFor: '198.51.100.20, 203.0.113.44',
      realIp: '203.0.113.44',
      trustedProxyCidrs: proxies,
    })).toBe('203.0.113.44');
    expect(resolveClientAddress({
      socketAddress: '10.1.2.3',
      forwardedFor: '198.51.100.20, 203.0.113.44',
      trustedProxyCidrs: proxies,
    })).toBe('203.0.113.44');
  });

  it('ignores spoofed headers while Railway mode is off', () => {
    const request = {
      socket: { remoteAddress: '203.0.113.10' },
      headers: {
        'x-forwarded-for': '198.51.100.20',
        'x-real-ip': '198.51.100.21',
      },
    };
    expect(railwayEdgeClientIpEnabled(undefined)).toBe(false);
    expect(railwayEdgeClientIpEnabled('')).toBe(false);
    expect(railwayEdgeClientIpEnabled('false')).toBe(false);
    expect(railwayEdgeClientIpEnabled('TRUE')).toBe(false);
    expect(railwayEdgeClientIpEnabled('true')).toBe(true);
    expect(rateLimitAddress(request, undefined, undefined)).toBe('203.0.113.10');
    expect(rateLimitAddress(request, undefined, 'false')).toBe('203.0.113.10');
    expect(rateLimitAddress(request, '10.0.0.0/8', 'production')).toBe('203.0.113.10');
  });

  it('uses one X-Real-IP address when Railway mode is on', () => {
    expect(resolveClientAddress({
      socketAddress: '10.1.2.3',
      forwardedFor: '198.51.100.20',
      realIp: '203.0.113.44',
      trustedProxyCidrs: [],
      trustRailwayEdgeClientIp: true,
    })).toBe('203.0.113.44');
    expect(resolveClientAddress({
      socketAddress: '10.1.2.3',
      forwardedFor: '198.51.100.20',
      realIp: '2001:DB8::44',
      trustedProxyCidrs: [],
      trustRailwayEdgeClientIp: true,
    })).toBe('2001:db8::44');
    expect(resolveClientAddress({
      socketAddress: '10.1.2.3',
      forwardedFor: '198.51.100.77',
      realIp: ['2001:db8::45'],
      trustedProxyCidrs: proxies,
      trustRailwayEdgeClientIp: true,
    })).toBe('2001:db8::45');
  });

  it('falls back to the socket when the Railway client address is unusable', () => {
    const socket = '10.1.2.3';
    const forwardedFor = '198.51.100.20';
    for (const realIp of [
      undefined,
      '',
      'not-an-ip',
      '203.0.113.44, 198.51.100.20',
      '203.0.113.44 198.51.100.20',
      ['203.0.113.44', '198.51.100.20'],
      '999.1.1.1',
    ]) {
      expect(resolveClientAddress({
        socketAddress: socket,
        forwardedFor,
        realIp,
        trustedProxyCidrs: [],
        trustRailwayEdgeClientIp: true,
      })).toBe(socket);
    }
  });

  it('does not accept an allow-all proxy range', () => {
    expect(trustedProxyCidrs('0.0.0.0/0, ::/0, 10.0.0.0/8')).toEqual(['10.0.0.0/8']);
    expect(resolveClientAddress({
      socketAddress: '203.0.113.10',
      forwardedFor: '198.51.100.20',
      trustedProxyCidrs: trustedProxyCidrs(''),
    })).toBe('203.0.113.10');
  });
});

describe('staging process boundaries', () => {
  it('keeps one dispatch worker inside the API and leaves retention unscheduled', () => {
    const providers = Reflect.getMetadata('providers', RiderModule) as unknown[];
    expect(providers.filter((provider) => provider === DispatchWorker)).toHaveLength(1);
    expect(providers.filter((provider) => provider === CoordinateRetentionWorker)).toHaveLength(1);
    expect(retentionSchedule({}).enabled).toBe(false);
    expect(retentionSchedule({ COORDINATE_RETENTION_ENABLED: 'false' }).enabled).toBe(false);
    const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    expect(main).toContain('enableShutdownHooks()');
    expect(main).not.toContain('trust proxy');
  });
});
