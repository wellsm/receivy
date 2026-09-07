export function proofUploadOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) return url.origin;
  } catch { /* Fail closed. */ }
  return null;
}
