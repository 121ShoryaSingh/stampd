const BASE = "http://stampd.local";

// Only allow same-site relative paths, to block open redirects.
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/")) return fallback;
  // Browsers strip tabs/newlines and treat "\" as "/", so parse like they do.
  if (/[\u0000-\u001f\\]/.test(next)) return fallback;
  const url = new URL(next, BASE);
  if (url.origin !== BASE) return fallback;
  return url.pathname + url.search + url.hash;
}
