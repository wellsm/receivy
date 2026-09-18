import { HttpBadRequestError } from '@ez4/gateway';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keyset position in the `recent` order; `last` is null once the never-billed tail is reached. */
export type RecentCursor = { last: string | null; name: string; id: string };

/** Only the `recent` order sends this shape; the default listing keeps its plain id cursor. */
export function decodeRecentCursor(cursor?: string): RecentCursor | undefined {
  if (!cursor) {
    return undefined;
  }

  let parsed: Partial<RecentCursor> | null = null;

  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<RecentCursor>;
  } catch {
    throw new HttpBadRequestError('Cursor inválido.');
  }

  if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string' || !UUID.test(String(parsed.id))) {
    throw new HttpBadRequestError('Cursor inválido.');
  }

  // An empty `last` is neither a timestamp nor the never-billed tail; it would silently widen the page.
  if (parsed.last !== null && (typeof parsed.last !== 'string' || !parsed.last)) {
    throw new HttpBadRequestError('Cursor inválido.');
  }

  return { last: parsed.last, name: parsed.name, id: parsed.id! };
}

export function encodeRecentCursor(cursor: RecentCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
