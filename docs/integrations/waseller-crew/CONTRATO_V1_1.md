# Contrato HTTP v1.1 — shadow compare (coordinación Waseller ↔ waseller-crew)

**Estado:** cuerpo opcional + Bearer **implementados en Waseller** (`shadow-compare.service.ts` + orquestador). **waseller-crew** debe aceptar los campos nuevos y, si usan auth, validar `SHADOW_COMPARE_SECRET` + `SHADOW_COMPARE_REQUIRE_AUTH` como acordaron.  
**Compatibilidad:** `schemaVersion` y `kind` **sin cambio** respecto a v1; los campos nuevos son **opcionales**. Los clientes que solo implementaron v1 siguen siendo válidos.

**Resumen en una frase:** el siguiente paso global sigue siendo **desplegar waseller-crew con URL estable y validar en staging**; Waseller ya envía **body extendido + Bearer opcional**; el crew debe **aceptar/validar** según `CONTRATO_V1_1.md` y sus env.

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

**No** se cambia en v1.1: `schemaVersion`, `kind`, `tenantId`, `leadId`, `incomingText`, `interpretation`, `baselineDecision` (siguen como hoy).

---

## 2. Autenticación (header + variables de entorno)

### Waseller (workers) — implementado

| Variable | Obligatoriedad | Descripción |
|----------|----------------|-------------|
| `LLM_SHADOW_COMPARE_SECRET` | Opcional | Secreto compartido. Si está **definido y no vacío**, el worker envía header de auth (ver abajo). Si está vacío / ausente, **no** envía el header (compatible con entornos sin secret). |

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
  "interpretation": { },
  "baselineDecision": { }
}
```

(`interpretation` y `baselineDecision` van completos como en v1; aquí se omiten por brevedad.)

---

## 5. Checklist de implementación coordinada

| Lado | Tarea |
|------|--------|
| **Waseller** | Hecho: opcionales + Bearer en `logShadowExternalCompareIfConfigured`; orquestador pasa `phone` y `recentMessages`; `infra/env/.env.example` documenta `LLM_SHADOW_COMPARE_SECRET`. |
| **waseller-crew** | Extender `ShadowCompareRequest` (Pydantic); README; fixture `request.v1_1.example.json`; middleware FastAPI para Bearer cuando `SHADOW_COMPARE_REQUIRE_AUTH` / `SHADOW_COMPARE_SECRET`. |
| **Ops** | Mismo valor en `LLM_SHADOW_COMPARE_SECRET` (workers) y `SHADOW_COMPARE_SECRET` (crew); prod con `SHADOW_COMPARE_REQUIRE_AUTH=true`. |

---

## 6. Tareas opcionales en el monorepo (si lo piden después)

- `Dockerfile` / `docker-compose.yml` para reproducir workers + DB no es necesario para waseller-crew; corresponde al **repo waseller-crew**.
- Workflow **GitHub Actions** en waseller-crew: lint + `pytest` + build imagen; plantilla genérica puede vivir en waseller-crew sin tocar Waseller.
