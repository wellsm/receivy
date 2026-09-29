/**
 * Search stays plain text: links sent by e-mail, WhatsApp and payment providers carry `?returned=1`,
 * not the JSON-encoded values TanStack Router writes by default.
 */
export function parseSearch(searchStr: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};

  for (const [key, value] of new URLSearchParams(searchStr)) {
    const current = result[key];

    if (current === undefined) {
      result[key] = value;

      continue;
    }

    result[key] = Array.isArray(current) ? [...current, value] : [current, value];
  }

  return result;
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) {
      continue;
    }

    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, String(item));
    }
  }

  const query = params.toString();

  return query ? `?${query}` : "";
}
