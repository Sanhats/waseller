# Contrato HTTP v1.1 — shadow compare (coordinación Waseller ↔ waseller-crew)

**Estado:** cuerpo opcional + Bearer **implementados en Waseller** (`shadow-compare.service.ts` + orquestador). **waseller-crew** confirmó que **acepta** `stockTable` (hasta 500 filas, modelo flexible alineado a filas tipo `GET /products`) y `businessProfileSlug` con el patrón seguro documentado abajo; valida `Authorization: Bearer` contra `SHADOW_COMPARE_SECRET` cuando `SHADOW_COMPARE_REQUIRE_AUTH=true` (recomendado en prod; mismo valor que `LLM_SHADOW_COMPARE_SECRET` en workers).  
**Compatibilidad:** `schemaVersion` y `kind` **sin cambio** respecto a v1; los campos nuevos son **opcionales**. Los clientes que solo implementaron v1 siguen siendo válidos.

**Documentación cruzada:** en el repo **waseller-crew** el archivo `docs/CONTRATO_HTTP_V1_1.md` describe el mismo contrato y **remite a este documento** como referencia de lo que serializa Waseller (main). Aquí se mantiene la descripción orientada al monorepo Waseller.

**Resumen operativo:** Waseller envía **body extendido + Bearer opcional**; URL del crew: `POST /shadow-compare` o **`POST /v1/shadow-compare`** (mismo contrato). El crew no impone un timeout HTTP más agresivo que el de la plataforma; el volumen de 500 filas afecta sobre todo el tiempo del LLM (CrewAI). Si los workers ven **abortos por timeout**, subir **`LLM_SHADOW_COMPARE_TIMEOUT_MS`** en el servicio de workers (Railway, etc.).

**Modo primary (`WASELLER_CREW_PRIMARY=true`):** los workers llaman **una vez** al mismo endpoint; si la respuesta incluye `candidateDecision.draftReply` válido, **reemplazan** la decisión del LLM interno (OpenAI/self-hosted) antes del verificador y guardrails. No se hace un segundo POST de “shadow compare” en ese turno. Traza `trace_kind = crew_primary` en `llm_traces`. En **shadow** (política de rollout), el texto al cliente puede seguir yendo por plantillas del lead worker salvo que operen en **active** y el flujo use el `draftReply` del LLM.

---

## 1. Campos nuevos opcionales en el body (POST)

Todos **opcionales**. Tipos alineados a uso en workers / Prisma (strings UUID donde corresponda).

| Campo | Tipo | Obligatoriedad | Descripción |
|--------|------|----------------|-------------|
| `phone` | `string` | Opcional | Teléfono del contacto en el formato que ya usa Waseller en colas (ej. dígitos / id de canal). |
| `correlationId` | `string` | Opcional | UUID de correlación del flujo de mensaje (mismo que en jobs de cola). |
| `messageId` | `string` | Opcional | UUID del registro `Message` asociado al turno. |
| `conversationId` | `string \| null` | Opcional | UUID de conversación; `null` si no aplica. |
| `recentMessages` | `array` | Opcional | Ventana corta de contexto; cada ítem: `{ "direction": "incoming" \| "outgoing", "message": "string" }`. **Tope recomendado enviado por Waseller:** 8 ítems (orden cronológico o explícito en doc del PR). |
| `stockTable` | `array` | Opcional | Filas de inventario con las **mismas propiedades** que devuelve `GET /products` (variante por fila: `variantId`, `productId`, `name`, `sku`, `attributes`, `stock`, `reservedStock`, `availableStock`, `effectivePrice`, `imageUrl`, `isActive`, `tags`, `basePrice`, `variantPrice`). Waseller envía solo si hay al menos una fila; **tope 500** filas por request (mismo tope que valida el crew). Cuando hay `variantId` en contexto (`activeOffer` / interpretación), **solo variantes del mismo `productId`** (catálogo coherente con la consulta). |
| `inventoryNarrowingNote` | `string` | Opcional | Solo si `stockTable` tiene **una** fila y el scope fue por producto: texto fijo para que el modelo no invente otras combinaciones de color/talle. Ignorable si el crew usa `extra = ignore` en Pydantic. |
| `businessProfileSlug` | `string` | Opcional | Patrón seguro `[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}`. Waseller lo deriva del rubro `tenant_knowledge.business_category` cuando no es `general` y cumple el patrón (p. ej. `indumentaria_calzado`); el crew puede cargar `tenant_prompts/<slug>.txt` en su deploy. |

**No** se cambia en v1.1: `schemaVersion`, `kind`, `tenantId`, `leadId`, `incomingText`, `interpretation`, `baselineDecision` (siguen como hoy).

---

## 2. Autenticación (header + variables de entorno)

### Waseller (workers) — implementado

| Variable | Obligatoriedad | Descripción |
|----------|----------------|-------------|
| `LLM_SHADOW_COMPARE_SECRET` | Opcional | Secreto compartido. Si está **definido y no vacío**, el worker envía header de auth (ver abajo). Si está vacío / ausente, **no** envía el header (compatible con entornos sin secret). **Alias:** si no está definido, el worker también lee **`SHADOW_COMPARE_SECRET`** (útil si en Railway usás el mismo nombre que en waseller-crew). |
| `LLM_SHADOW_COMPARE_TIMEOUT_MS` | Opcional | Timeout del `fetch` en workers (default **8000** ms, máximo **120000**). Con `stockTable` grande o Crew lento, conviene aumentarlo para evitar cortes antes de la respuesta HTTP. |

**Header (cuando el secret está configurado):**

```http
Authorization: Bearer <valor de LLM_SHADOW_COMPARE_SECRET>
```

- **Content-Type** sigue siendo `application/json`.

### waseller-crew (FastAPI)

| Variable | Obligatoriedad | Descripción |
|----------|----------------|-------------|
| `SHADOW_COMPARE_SECRET` | Recomendada en prod | Mismo valor que `LLM_SHADOW_COMPARE_SECRET` en workers (o nombre unificado en doc de deploy). Usada para validar `Bearer`. |
| `SHADOW_COMPARE_REQUIRE_AUTH` | Opcional | `"true"` \| `"false"` (default recomendado: **`false`** en local/staging sin secret; **`true`** en producción cuando el endpoint es público). Si es `true` y falta `Authorization` o el token no coincide → **401**. |

**Política acordada:**

- **No** hacemos “header obligatorio solo en prod” en el código de Waseller por entorno: Waseller **solo envía** Bearer si hay secret configurado (evita 401 en staging olvidado).
- **waseller-crew** controla exigencia estricta con **`SHADOW_COMPARE_REQUIRE_AUTH=true`** en producción (rechaza sin Bearer válido).

---

## 3. JSON mínimo (solo v1 — sin PR v1.1)

Igual que hoy. `schemaVersion` numérico **1**.

```json
{
  "schemaVersion": 1,
  "kind": "waseller.shadow_compare.v1",
  "tenantId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "leadId": "11111111-2222-3333-4444-555555555555",
  "incomingText": "Hola, precio de la remera negra M?",
  "interpretation": {
    "intent": "consultar_precio",
    "confidence": 0.9,
    "entities": {},
    "references": [],
    "missingFields": [],
    "nextAction": "reply_only",
    "source": "openai"
  },
  "baselineDecision": {
    "intent": "consultar_precio",
    "leadStage": "consideration",
    "confidence": 0.75,
    "entities": {},
    "nextAction": "reply_only",
    "reason": "baseline",
    "requiresHuman": false,
    "recommendedAction": "reply_only",
    "draftReply": "…",
    "handoffRequired": false,
    "qualityFlags": [],
    "source": "llm"
  }
}
```

---

## 4. JSON máximo (v1 + opcionales v1.1)

Mismo núcleo que arriba **más** campos opcionales (ejemplo ilustrativo):

```json
{
  "schemaVersion": 1,
  "kind": "waseller.shadow_compare.v1",
  "tenantId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "leadId": "11111111-2222-3333-4444-555555555555",
  "phone": "5491112345678",
  "correlationId": "22222222-3333-4444-5555-666666666666",
  "messageId": "33333333-4444-5555-6666-777777777777",
  "conversationId": "44444444-5555-6666-7777-888888888888",
  "incomingText": "Hola, precio de la remera negra M?",
  "recentMessages": [
    { "direction": "outgoing", "message": "Hola, ¿en qué te ayudo?" },
    { "direction": "incoming", "message": "Hola, precio de la remera negra M?" }
  ],
  "businessProfileSlug": "indumentaria_calzado",
  "stockTable": [
    {
      "variantId": "…",
      "productId": "…",
      "name": "Remera básica",
      "sku": "REM-BLK-M",
      "attributes": { "talle": "M", "color": "negro" },
      "stock": 4,
      "reservedStock": 0,
      "availableStock": 4,
      "effectivePrice": 12990,
      "imageUrl": null,
      "isActive": true,
      "tags": [],
      "basePrice": 12990,
      "variantPrice": null
    }
  ],
  "interpretation": { },
  "baselineDecision": { }
}
```

(`interpretation` y `baselineDecision` van completos como en v1; aquí se omiten por brevedad.)

---

## 5. Checklist de implementación coordinada

| Lado | Tarea |
|------|--------|
| **Waseller** | Hecho: opcionales + Bearer en `logShadowExternalCompareIfConfigured`; orquestador enriquece `recentMessages` con último bot vía `bot_response_events` si falta el `outgoing` en `messages` (carrera con sender); acota `stockTable` al producto en contexto; `inventoryNarrowingNote` si una sola fila; traza `reply` con `conversationDiagnostics.baselineEchoesLastOutgoing`; lead worker ajusta seguimientos en shadow; `infra/env/.env.example` documenta `LLM_SHADOW_COMPARE_SECRET`. |
| **waseller-crew** | **Hecho (confirmado por crew):** acepta opcionales v1.1; Bearer vs `SHADOW_COMPARE_SECRET` con `SHADOW_COMPARE_REQUIRE_AUTH`; ver su `docs/CONTRATO_HTTP_V1_1.md` y fixtures. |
| **Ops** | Mismo valor en `LLM_SHADOW_COMPARE_SECRET` (workers) y `SHADOW_COMPARE_SECRET` (crew); prod con `SHADOW_COMPARE_REQUIRE_AUTH=true`. Tráfico **2xx** tras deploy: verificar con smoke en shadow + logs Railway (workers y crew) o métricas del balanceador. |

---

## 6. Tareas opcionales en el monorepo (si lo piden después)

- `Dockerfile` / `docker-compose.yml` para reproducir workers + DB no es necesario para waseller-crew; corresponde al **repo waseller-crew**.
- Workflow **GitHub Actions** en waseller-crew: lint + `pytest` + build imagen; plantilla genérica puede vivir en waseller-crew sin tocar Waseller.
