/** Base URL del API (mismo origen en Vercel: `/api`). */
export function getClientApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  if (typeof window !== "undefined") return `${window.location.origin}/api`;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}/api`;
  return "http://localhost:3000/api";
}
