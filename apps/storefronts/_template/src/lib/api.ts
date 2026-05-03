import { createStorefrontClient } from "@waseller/storefront-sdk";

/** Lee envs con validación al startup — fail fast si están mal. */
function requireEnv(name: string): string {
  const v = String(process.env[name] ?? "").trim();
  if (!v) {
    throw new Error(
      `Falta ${name}. Copiá .env.example a .env.local y completalo (o setealo en Vercel).`
    );
  }
  return v;
}

/** Cliente compartido para todo el storefront. Server y client component pueden usarlo. */
export const api = createStorefrontClient({
  baseUrl: requireEnv("NEXT_PUBLIC_API_BASE"),
  slug: requireEnv("NEXT_PUBLIC_TENANT_SLUG"),
});

export const TENANT_SLUG = requireEnv("NEXT_PUBLIC_TENANT_SLUG");
