# Checklist de paridad API (Nest → Next Route Handlers)

Prefijo global actual: **`/api`**. Marcar `[x]` cuando exista handler equivalente en `apps/dashboard/src/app/api/...` y el smoke pase contra esa ruta.

## Health

- [x] `GET /api/health` (piloto Next)

## Auth

- [x] `POST /api/auth/login` (piloto en Next: `apps/dashboard/src/app/api/auth/login/route.ts`)
- [x] `POST /api/auth/register-tenant` (piloto en Next: `.../register-tenant/route.ts`)

## Messages

- [ ] `POST /api/messages/incoming`

## Leads

- [ ] `GET /api/leads`
- [ ] `POST /api/leads/:leadId/hide-from-inbox`
- [ ] `POST /api/leads/:leadId/restore-to-inbox`
- [ ] `PATCH /api/leads/:leadId/status`
- [ ] `PATCH /api/leads/:leadId/mark-cobrado`
- [ ] `PATCH /api/leads/:leadId/mark-despachado`
- [ ] `PATCH /api/leads/:leadId/release-reservation`

## Conversations

- [ ] `GET /api/conversations/:phone`
- [ ] `GET /api/conversations/:phone/state`
- [ ] `GET /api/conversations/:phone/payment-links`
- [ ] `POST /api/conversations/:phone/reply`
- [ ] `POST /api/conversations/:phone/payment-links/prepare`
- [ ] `POST /api/conversations/:phone/payment-links/:attemptId/send`
- [ ] `POST /api/conversations/:phone/resolve`
- [ ] `POST /api/conversations/:phone/reopen`
- [ ] `POST /api/conversations/:phone/close-lead`
- [ ] `POST /api/conversations/:phone/archive`
- [ ] `POST /api/conversations/:phone/unarchive`
- [ ] `POST /api/conversations/:phone/handoff`

## Products

- [ ] `GET /api/products`
- [ ] `POST /api/products`
- [ ] `POST /api/products/:productId/variants`
- [ ] `PATCH /api/products/variants/:variantId/adjust`
- [ ] `PATCH /api/products/variants/:variantId`
- [ ] `GET /api/products/movements`
- [ ] `PATCH /api/products/:productId`

## Dashboard

- [ ] `GET /api/dashboard/summary`

## Onboarding

- [ ] `GET /api/onboarding/status`
- [ ] `GET /api/onboarding/whatsapp/session`
- [ ] `POST /api/onboarding/whatsapp/connect`
- [ ] `GET /api/onboarding/whatsapp/qr.png`

## Mercado Pago

- [ ] `GET /api/integrations/mercadopago/connect-url`
- [ ] `GET /api/integrations/mercadopago/status`
- [ ] `POST /api/integrations/mercadopago/disconnect`
- [ ] `GET /api/integrations/mercadopago/callback`
- [ ] `POST /api/payments/mercadopago/webhook`

## Ops (admin)

- [ ] `GET /api/ops/queues`
- [ ] `GET /api/ops/funnel`
- [ ] `GET /api/ops/playbooks`
- [ ] `GET /api/ops/templates`
- [ ] `PUT /api/ops/templates`
- [ ] `GET /api/ops/tenant-knowledge`
- [ ] `GET /api/ops/tenant-knowledge/presets`
- [ ] `PUT /api/ops/tenant-knowledge`
- [ ] `PUT /api/ops/playbooks`
- [ ] `GET /api/ops/tenant-settings`
- [ ] `PUT /api/ops/tenant-settings`
- [ ] `GET /api/ops/quality`
- [ ] `GET /api/ops/playbook-report`
- [ ] `POST /api/ops/feedback`
- [ ] `GET /api/ops/eval-dataset`
- [ ] `GET /api/ops/eval-dataset/export`
- [ ] `POST /api/ops/eval-dataset`
- [ ] `PUT /api/ops/eval-dataset/:itemId`
- [ ] `POST /api/ops/eval-dataset/from-feedback`

## Smoke

```bash
SMOKE_API_BASE_URL=https://tu-app.vercel.app/api node scripts/smoke-check.mjs
# o contra Railway Nest:
SMOKE_API_BASE_URL=https://tu-api.up.railway.app/api node scripts/smoke-check.mjs
```
