/** Origen sin path (solo host/puerto) → API en `/api` del mismo deploy. */
function withDefaultApiPath(base: string): string {
  const s = base.replace(/\/$/, "");
  if (/\/api(\/|$)/.test(s)) return s;
  if (/^https?:\/\/[^/?#]+$/.test(s)) return `${s}/api`;
  return s;
}

/** Base URL del API (mismo origen en Vercel: `/api`). */
export function getClientApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (raw) return withDefaultApiPath(raw);
  if (typeof window !== "undefined") return `${window.location.origin}/api`;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}/api`;
  return "http://localhost:3000/api";
}
