import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { encodeListCursor, readListCursor } from './list-cursor.js';

const ID = '018f5b4a-7c3a-7c3a-8c3a-000000000021';
const AT = new Date('2026-10-18T08:00:00.000Z');

describe('readListCursor', () => {
  it('defaults to 20 and accepts a timestamp and id cursor', () => {
    expect(readListCursor(undefined, undefined)).toEqual({ limit: 20 });
    expect(readListCursor('20', encodeListCursor(AT, ID))).toEqual({ limit: 20, cursor: { at: AT, id: ID } });
    expect(readListCursor('100', undefined).limit).toBe(100);
  });

  it('retains all six fractional digits in a PostgreSQL cursor', () => {
    const exact = '2026-11-26T19:30:15.123456Z';
    expect(readListCursor('1', encodeListCursor(exact, ID)).cursor).toEqual({ at: new Date(exact), exact, id: ID });
    expect(encodeListCursor('2026-10-18T08:00:00.000000Z', ID)).toBe(encodeListCursor(AT, ID));
  });

  it('rejects limits outside 1 to 100 and cursors that are not a timestamp and id', () => {
    expect(() => readListCursor('0', undefined)).toThrow(BadRequestException);
    expect(() => readListCursor('101', undefined)).toThrow(BadRequestException);
    expect(() => readListCursor('20.5', undefined)).toThrow(BadRequestException);
    expect(() => readListCursor('20', '1')).toThrow(BadRequestException);
    expect(() => readListCursor('20', ID)).toThrow(BadRequestException);
    expect(() => readListCursor('20', encodeListCursor(AT, 'not-a-uuid'))).toThrow(BadRequestException);
  });
});
