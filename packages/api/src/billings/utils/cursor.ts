/** Keyset position of the billing list: newest first, ties broken by id. */
export type ListCursor = { createdAt: string; id: string };

export function decodeListCursor(cursor?: string): ListCursor | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };

    return typeof parsed.createdAt === 'string' && typeof parsed.id === 'string' ? { createdAt: parsed.createdAt, id: parsed.id } : undefined;
  } catch {
    return undefined;
  }
}

export function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
