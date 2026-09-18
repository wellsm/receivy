/**
 * What a search box typed, as a `contains` filter may take it: NFC, trimmed, capped, and with the LIKE
 * wildcards escaped. EZ4 compiles `contains` into `ILIKE '%' || :term || '%'`, so a literal `%` or `_`
 * would otherwise match anything.
 */
export function searchTerm(search: string, max = 254): string {
  return search
    .normalize('NFC')
    .trim()
    .slice(0, max)
    .replace(/[\\%_]/g, (wildcard) => `\\${wildcard}`);
}
