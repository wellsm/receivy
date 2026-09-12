export function notificationUrl(
  value: unknown,
  configuredOrigin: string | undefined,
): string | null {
  if (typeof value !== "string" || !configuredOrigin) return null;
  try {
    const origin = new URL(configuredOrigin);
    const url = new URL(value);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.origin !== origin.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/(pay\/[A-Za-z0-9_.-]+|billings\/[0-9a-f-]{36})$/.test(url.pathname)
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}
