# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev                                # Backend (NestJS, hot-reload via ts-node-dev)
npm run dev --workspace @waseller/dashboard  # Dashboard (Next.js)

# Build (packages must be built before apps)
npm run build:packages   # Build shared/queue/db/api-core
npm run build:api        # packages + NestJS backend
npm run build            # packages + dashboard (Vercel build target)
npm run build:all        # Everything

# Database
npm run db:generate      # Regenerate Prisma client after schema changes
npm run db:migrate       # Run migrations (loads infra/env/.env.local)
npm run db:push          # Push schema without migration file

# Seeding / testing
npm run seed:test-lead
npm run seed:demo-scenarios
npm run smoke            # Smoke check
npm run redis:check      # Verify Redis connection

# Lint / test
npm run lint
npm run test
```

For DB commands locally, `packages/db/scripts/run-with-local-env.mjs` auto-loads `infra/env/.env.local`. Copy `infra/env/.env.example` to `infra/env/.env.local` for local development.

## Architecture

### Monorepo layout

| Package | Role |
|---------|------|
| `apps/backend` | NestJS REST API (standalone Express process) |
| `apps/dashboard` | Next.js app — dashboard UI + all API routes for production |
| `apps/workers` | BullMQ background workers (message processing, LLM, sender, stock) |
| `apps/whatsapp` | Baileys WhatsApp bridge (manages WA sessions, enqueues incomings) |
| `packages/db` | Prisma schema + singleton client (`prisma` export) |
| `packages/shared` | Shared types, `TenantBusinessProfile`, `TENANT_HEADER`, `LeadStatus`, etc. |
| `packages/queue` | BullMQ queue definitions + Redis connection |
| `packages/api-core` | JWT auth utilities shared between dashboard and backend |

### Key architectural pattern: dashboard-as-API-host

In production (Vercel), the Next.js dashboard hosts **all API routes** via a catch-all route handler at `apps/dashboard/src/app/api/[...slug]/route.ts`. This handler calls `dispatchApi()` from `apps/dashboard/src/lib/api-gateway.ts`, which instantiates NestJS services directly (no HTTP round-trip). The standalone `apps/backend` NestJS process exists as an alternative deployment option.

When adding a new API route, add it to `api-gateway.ts` (dashboard path routing) and the corresponding NestJS controller/service pair.

### Multi-tenancy

Every Prisma query must be scoped to `tenantId` (UUID). Auth middleware (`apps/backend/src/common/auth/auth.middleware.ts`) and the dashboard `resolveAuth()` function both validate the Bearer JWT and set `tenantId`. The only public-without-auth routes are: `POST /api/messages/incoming` (uses `x-tenant-id` header), Mercado Pago webhook/callback, and the public catalog (`/tienda/[slug]`).

Roles: `admin`, `vendedor`, `viewer` — enforced via `requireRole()` from `@waseller/api-core`.

### Message / conversation pipeline

```
WhatsApp message → apps/whatsapp (Baileys)
  → POST /api/messages/incoming → enqueued to BullMQ `incoming_messages`
  → message-processor.worker → conversation-orchestrator.worker
  → lead.worker → sender.worker → back to WhatsApp
```

Workers also handle: stock reservation expiry (`reservation-expiry.worker`), stock sync (`stock-sync.worker`), LLM traces, and optional shadow-compare with an external `waseller-crew` LLM service.

### Products & variants data model

- `Product` → many `ProductVariant` (each with a unique `sku` per tenant)
- Variant `attributes` is a JSON blob; the indexed columns `variantTalle`, `variantColor`, `variantMarca` mirror the relevant attribute values for fast SQL filtering
- `Category` supports tree hierarchy via `parentId`; categories link to products via `ProductCategory` and to individual variants via `VariantCategory`
- Stock tracking: `ProductVariant.stock` / `reservedStock`; all changes log a `StockMovement` row
- `products.service.ts` uses `$queryRawUnsafe` with positional parameters (`$1`, `$2`, …) for the main listing query because composing Prisma `Sql` tags across Next.js/NestJS bundle boundaries can break

### Database connection

`packages/db/src/index.ts` auto-adds `?pgbouncer=true` when `DATABASE_URL` points to a Supabase transaction pooler (port 6543). In Vercel serverless it also sets `connection_limit=1`. Always use the pooler URL in `DATABASE_URL` and the direct connection in `DIRECT_DATABASE_URL` (needed by Prisma migrate).

## Environment variables

See `infra/env/.env.example` for the full list. Critical ones:

| Variable | Where needed |
|----------|-------------|
| `DATABASE_URL` | All apps (pooled, port 6543 for Supabase) |
| `DIRECT_DATABASE_URL` | DB migrations only |
| `REDIS_URL` | Dashboard (enqueue) + workers + whatsapp |
| `AUTH_TOKEN_SECRET` | Dashboard + backend (JWT signing) |
| `AUTH_PASSWORD_PEPPER` | Backend (password hashing) |
| `WHATSAPP_SERVICE_URL` | Dashboard/backend → calls the WhatsApp service |
| `PUBLIC_API_BASE_URL` | Workers (callback URLs, payment webhooks) |
| `NEXT_PUBLIC_TENANT_ID` | Dashboard client (single-tenant dashboard) |

## Deployment

| Layer | Provider |
|-------|----------|
| Dashboard + API | **Vercel** — `npm run build` |
| Workers | **Railway** — `infra/railway/Dockerfile.workers` |
| WhatsApp bridge | **Railway** — `infra/railway/Dockerfile.whatsapp` |
| Postgres | **Supabase** |
| Redis | **Upstash** (`rediss://` TLS URL) |

See `infra/deployment-strategy.md` for deployment details and `infra/api-route-parity.md` for the route checklist.

## SQL patches

Raw SQL patches for schema changes that can't go through Prisma migrate live in `infra/sql/patches/`. Apply them manually to Supabase before or after the corresponding `prisma migrate deploy`.
