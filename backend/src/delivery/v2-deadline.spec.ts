import { describe, expect, it } from 'vitest';
import { v2RequestRemainsOpen } from './v2-deadline.js';

const NOW = new Date('2026-10-27T12:00:00.000Z');

describe('v2 request deadlines', () => {
  it('keeps a request open when it has no deadline and closes one whose deadline has passed', () => {
    expect(v2RequestRemainsOpen(null, NOW)).toBe(true);
    expect(v2RequestRemainsOpen(new Date(NOW.getTime() + 60_000), NOW)).toBe(true);
    expect(v2RequestRemainsOpen(new Date(NOW.getTime() - 1_000), NOW)).toBe(false);
    expect(v2RequestRemainsOpen(NOW, NOW)).toBe(false);
  });
});
