export function resolveMediaBase(base: string, override?: string): string {
  return (override?.trim() || base).replace(/\/$/, "");
}

const LEGACY_MEDIA_BASE = "https://0xlei.tech/words";

/** Return the legacy hosted equivalent for a same-site atlas media URL. */
export function legacyMediaFallback(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = "/atlas/";
  const offset = url.indexOf(marker);
  if (offset < 0) return null;
  const fallback = `${LEGACY_MEDIA_BASE}${url.slice(offset)}`;
  return fallback === url ? null : fallback;
}
