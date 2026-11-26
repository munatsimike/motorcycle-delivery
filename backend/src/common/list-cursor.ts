import { BadRequestException } from '@nestjs/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ListCursor = { at: Date; id: string; exact?: string };

// Opaque timestamp-and-id cursor. The row itself does not need to still exist.
// Callers must AND this filter with the authenticated account.
export function readListCursor(limit: unknown, cursor: unknown): { limit: number; cursor?: ListCursor } {
  const size = limit === undefined ? 20 : typeof limit === 'string' && /^\d+$/.test(limit) ? Number(limit) : NaN;
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new BadRequestException('Invalid page limit');
  if (cursor === undefined) return { limit: size };
  return { limit: size, cursor: readKeysetCursor(cursor) };
}

export function encodeListCursor(at: Date | string, id: string): string {
  return Buffer.from(`${typeof at === 'string' ? at.replace(/(\.\d{3})000Z$/, '$1Z') : at.toISOString()}\n${id}`, 'utf8').toString('base64url');
}

export function readKeysetCursor(cursor: unknown): ListCursor {
  if (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new BadRequestException('Invalid cursor');
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const split = decoded.split('\n');
  if (split.length !== 2) throw new BadRequestException('Invalid cursor');
  const [iso, id] = split;
  const at = new Date(iso ?? '');
  if (!iso || Number.isNaN(at.getTime()) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(iso) || at.toISOString() !== iso.replace(/(\.\d{3})\d{3}Z$/, '$1Z') || !id || !UUID.test(id)) {
    throw new BadRequestException('Invalid cursor');
  }
  return { at, id, ...(iso.length === 27 ? { exact: iso } : {}) };
}
