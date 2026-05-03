import { NextResponse, type NextRequest } from "next/server";
import { dispatchApi } from "@/lib/api-gateway";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Limites por IP para los endpoints públicos (sin JWT). Conservadores para frenar scraping/abuso obvio.
 *  GET: 120/min (catálogo, productos, store config). Suficiente para una sesión normal de browsing.
 *  POST checkout: 10/min — más de eso es un bot, no un comprador. */
const RATE_LIMIT_GET = { max: 120, windowSec: 60 };
const RATE_LIMIT_CHECKOUT = { max: 10, windowSec: 60 };

/**
 * CORS para los endpoints públicos del storefront (/api/public/*).
 *
 * Solo aplicamos a paths bajo `/public/` para no exponer accidentalmente endpoints autenticados.
 * La whitelist viene de PUBLIC_STOREFRONT_ALLOWED_ORIGINS (csv). Si no está seteada o no matchea,
 * no devolvemos Access-Control-Allow-Origin → el browser bloquea, lo que es el default seguro.
 *
 * `*` como entry permite cualquier origin (útil para sandbox/staging; no usar en prod con cookies).
 */

function isPublicPath(slug: string[]): boolean {
  return slug[0] === "public";
}

function parseAllowedOrigins(): string[] {
  return String(process.env.PUBLIC_STOREFRONT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeadersFor(req: NextRequest, slug: string[]): Record<string, string> {
  if (!isPublicPath(slug)) return {};
  const origin = req.headers.get("origin")?.trim();
  if (!origin) return {};
  const allowed = parseAllowedOrigins();
  const ok = allowed.includes("*") || allowed.includes(origin);
  if (!ok) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function applyCors(res: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

async function applyPublicRateLimit(
  req: NextRequest,
  method: string,
  slugs: string[]
): Promise<NextResponse | null> {
  if (!isPublicPath(slugs)) return null;
  const isCheckout = method === "POST" && slugs[1] === "checkout";
  const config = isCheckout ? RATE_LIMIT_CHECKOUT : RATE_LIMIT_GET;
  /** Bucket per IP + path bucket (GET vs checkout) — un atacante no puede consumir el budget
   *  del checkout haciendo GETs ni viceversa. */
  const ip = clientIp(req);
  const bucket = isCheckout ? "checkout" : "read";
  const key = `public:${bucket}:${ip}`;
  const result = await rateLimit(key, config.max, config.windowSec);
  if (result.ok) return null;
  return NextResponse.json(
    { message: "Demasiadas solicitudes. Probá en unos segundos." },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.resetSec),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}

async function handle(
  req: NextRequest,
  method: string,
  ctx: { params: Promise<{ slug: string[] }> }
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const slugs = slug ?? [];
  const limited = await applyPublicRateLimit(req, method, slugs);
  if (limited) return applyCors(limited, corsHeadersFor(req, slugs));
  const res = await dispatchApi(req, method, slugs);
  return applyCors(res, corsHeadersFor(req, slugs));
}

export async function OPTIONS(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  const slugs = slug ?? [];
  /** Preflight: si el path es público y el origin está permitido, respondemos 204 con headers. */
  if (isPublicPath(slugs)) {
    const headers = corsHeadersFor(req, slugs);
    if (Object.keys(headers).length > 0) {
      return new NextResponse(null, { status: 204, headers });
    }
  }
  return new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  return handle(req, "GET", ctx);
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  return handle(req, "HEAD", ctx);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  return handle(req, "POST", ctx);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  return handle(req, "PUT", ctx);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  return handle(req, "PATCH", ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ slug: string[] }> }) {
  return handle(req, "DELETE", ctx);
}
