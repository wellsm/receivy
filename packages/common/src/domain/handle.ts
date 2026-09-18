/** An InfiniteTag as InfinitePay accepts it: no `$`, lowercase, letters/digits/`._-`, 2 to 40 characters. Confirmed against a real handle on first use; loosen here if InfinitePay accepts more. */
const HANDLE = /^[a-z0-9][a-z0-9._-]{1,39}$/;

export function normalizeHandle(value: string): string {
  const normalized = value.normalize('NFC').trim().replace(/^\$+/, '').toLowerCase();

  if (!HANDLE.test(normalized)) {
    throw new RangeError('Handle inválido.');
  }

  return normalized;
}
