# Contrato HTTP v1.1 — shadow compare (coordinación Waseller ↔ waseller-crew)

**Estado:** cuerpo opcional + Bearer **implementados en Waseller** (`shadow-compare.service.ts` + orquestador). **waseller-crew** confirmó que **acepta** `stockTable` (hasta 500 filas, modelo flexible alineado a filas tipo `GET /products`) y `businessProfileSlug` con el patrón seguro documentado abajo; valida `Authorization: Bearer` contra `SHADOW_COMPARE_SECRET` cuando `SHADOW_COMPARE_REQUIRE_AUTH=true` (recomendado en prod; mismo valor que `LLM_SHADOW_COMPARE_SECRET` en workers).  
**Compatibilidad:** `schemaVersion` y `kind` **sin cambio** respecto a v1; los campos nuevos son **opcionales**. Los clientes que solo implementaron v1 siguen siendo válidos.

**Documentación cruzada:** en el repo **waseller-crew** el archivo `docs/CONTRATO_HTTP_V1_1.md` describe el mismo contrato y **remite a este documento** como referencia de lo que serializa Waseller (main). Aquí se mantiene la descripción orientada al monorepo Waseller.

**Resumen operativo:** Waseller envía **body extendido + Bearer opcional**; URL del crew: `POST /shadow-compare` o **`POST /v1/shadow-compare`** (mismo contrato). El crew no impone un timeout HTTP más agresivo que el de la plataforma; el volumen de 500 filas afecta sobre todo el tiempo del LLM (CrewAI). Si los workers ven **abortos por timeout**, subir **`LLM_SHADOW_COMPARE_TIMEOUT_MS`** en el servicio de workers (Railway, etc.).

**Modo primary (`WASELLER_CREW_PRIMARY=true`):** los workers llaman **una vez** al mismo endpoint; si la respuesta incluye `candidateDecision.draftReply` válido, **reemplazan** la decisión del LLM interno (OpenAI/self-hosted) antes del verificador y guardrails. Con primary activo **no** se invoca el POST adicional de telemetría `shadow_compare` (evita dos `POST` con el mismo `correlationId` al crew). Solo queda la traza `trace_kind = crew_primary` en `llm_traces` para ese turno. En **shadow** (política de rollout), el texto al cliente puede seguir yendo por plantillas del lead worker salvo que operen en **active** y el flujo use el `draftReply` del LLM.

**Tamaño del payload hacia el crew:** Waseller **recorta** textos y campos pesados en el JSON HTTP (mensaje entrante, `recentMessages`, `interpretation`, `baselineDecision`, filas de `stockTable` sin `tags` salvo configuración explícita). Los límites se ajustan con variables `LLM_SHADOW_COMPARE_MAX_*` (ver tabla en §2); defaults orientados a bajar tokens (~orden 10–20k) sin romper el contrato.

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
| `stockTable` | `array` | Opcional | Filas alineadas a `GET /products` (misma forma por variante). **Solo variantes `is_active` con `availableStock > 0`.** Con `variantId` / producto en contexto: todas las variantes de ese **un** `productId` (tope 500). Sin producto único: Waseller arma candidatos por **RAG** (nombre similiar al mensaje, hasta 3 `productId`) + opcional `entities.productId` de la interpretación; **tope de filas** configurable (`LLM_SHADOW_COMPARE_STOCK_RAG_ROW_LIMIT`, default **30**). Si no hay alcance posible, **no** se envía `stockTable`. |
| `inventoryNarrowingNote` | `string` | Opcional | Waseller envía **siempre** una nota en español que explica el alcance: producto único, multi-producto RAG, sin tabla por falta de contexto, o conjunto vacío tras filtros. waseller-crew la usa en el bloque de misión (`extra="ignore"` sigue aplicando a campos desconocidos). |
| `businessProfileSlug` | `string` | Opcional | Patrón seguro `[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}`. Waseller parte de `tenant_knowledge.business_category` y aplica **mapeo** a slugs del crew cuando hace falta (p. ej. `hogar_deco` → `muebles_deco`); valores como `indumentaria_calzado` o `repuestos_lubricentro` se envían tal cual si ya coinciden con el crew. |

**No** se cambia en v1.1: `schemaVersion`, `kind`, `tenantId`, `leadId`, `incomingText`, `interpretation`, `baselineDecision` (siguen como hoy).

---

## 2. Autenticación (header + variables de entorno)

### Waseller (workers) — implementado

| Variable | Obligatoriedad | Descripción |
|----------|----------------|-------------|
| `LLM_SHADOW_COMPARE_SECRET` | Opcional | Secreto compartido. Si está **definido y no vacío**, el worker envía header de auth (ver abajo). Si está vacío / ausente, **no** envía el header (compatible con entornos sin secret). **Alias:** si no está definido, el worker también lee **`SHADOW_COMPARE_SECRET`** (útil si en Railway usás el mismo nombre que en waseller-crew). |
| `LLM_SHADOW_COMPARE_TIMEOUT_MS` | Opcional | Timeout del `fetch` en workers (default **30000** ms, máximo **120000**). Tabla guía crew: ~15s con pocas filas, 30s con decenas, 60s con ~500 filas. |
| `LLM_SHADOW_COMPARE_STOCK_RAG_ROW_LIMIT` | Opcional | Máximo de filas de `stockTable` en modo multi-producto RAG (default **30**, rango 5–100). |
| `LLM_SHADOW_COMPARE_MAX_INCOMING_CHARS` | Opcional | Tope de caracteres de `incomingText` en el POST (default **2500**). |
| `LLM_SHADOW_COMPARE_MAX_RECENT_MSG_CHARS` | Opcional | Tope por ítem de `recentMessages[].message` (default **900**). |
| `LLM_SHADOW_COMPARE_MAX_REFERENCES` | Opcional | Máximo de ítems en `interpretation.references` (default **8**). |
| `LLM_SHADOW_COMPARE_MAX_NOTES` | Opcional | Máximo de notas en `interpretation.notes` (default **5**). |
| `LLM_SHADOW_COMPARE_MAX_ENTITY_VALUE_CHARS` | Opcional | Tope por valor string en `interpretation.entities` (default **320**). |
| `LLM_SHADOW_COMPARE_MAX_ENTITY_KEYS` | Opcional | Máximo de claves en `interpretation.entities` (default **28**). |
| `LLM_SHADOW_COMPARE_MAX_MISSING_FIELDS` | Opcional | Máximo de ítems en `interpretation.missingFields` (default **14**). |
| `LLM_SHADOW_COMPARE_MAX_DRAFT_CHARS` | Opcional | Tope de `baselineDecision.draftReply` (default **1400**). |
| `LLM_SHADOW_COMPARE_MAX_REASON_CHARS` | Opcional | Tope de `baselineDecision.reason` (default **420**). |
| `LLM_SHADOW_COMPARE_MAX_BASELINE_ENTITY_KEYS` | Opcional | Máximo de claves en `baselineDecision.entities` (default **24**). |
| `LLM_SHADOW_COMPARE_MAX_BASELINE_ENTITY_VALUE_CHARS` | Opcional | Tope por valor string en `baselineDecision.entities` (default **280**). |
| `LLM_SHADOW_COMPARE_MAX_STOCK_NAME_CHARS` | Opcional | Tope de `name` por fila de `stockTable` (default **120**). |
| `LLM_SHADOW_COMPARE_MAX_STOCK_SKU_CHARS` | Opcional | Tope de `sku` por fila (default **64**). |
| `LLM_SHADOW_COMPARE_MAX_STOCK_ATTR_KEYS` | Opcional | Máximo de atributos por variante en `stockTable` (default **12**). |
| `LLM_SHADOW_COMPARE_MAX_STOCK_ATTR_VALUE_CHARS` | Opcional | Tope por valor de atributo (default **80**). |
| `LLM_SHADOW_COMPARE_INCLUDE_STOCK_IMAGE_URL` | Opcional | Si es `true`/`1`/`yes`, incluye `imageUrl` en filas de stock (por defecto **no**, para ahorrar tokens). |

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
| **waseller-crew** | **Hecho:** ver **§7** (paridad detallada). Repo: `docs/CONTRATO_HTTP_V1_1.md` (incl. observabilidad §4.2), `fixtures/request.v1_1.example.json`, tests API. **Mejora continua de conversación:** ver **§8** (prompt / anti-eco / volumen / catálogo). |
| **Ops** | Mismo valor en `LLM_SHADOW_COMPARE_SECRET` (workers) y `SHADOW_COMPARE_SECRET` (crew); prod con `SHADOW_COMPARE_REQUIRE_AUTH=true`. Tráfico **2xx** tras deploy: verificar con smoke en shadow + logs Railway (workers y crew) o métricas del balanceador. |

---

## 6. Tareas opcionales en el monorepo (si lo piden después)

- `Dockerfile` / `docker-compose.yml` para reproducir workers + DB no es necesario para waseller-crew; corresponde al **repo waseller-crew**.
- Workflow **GitHub Actions** en waseller-crew: lint + `pytest` + build imagen; plantilla genérica puede vivir en waseller-crew sin tocar Waseller.

---

## 7. Paridad waseller-crew (microservicio) — resumen para quien trabaja solo en Waseller

Lo siguiente está **implementado en el repo waseller-crew** (no en este monorepo); se documenta aquí para una sola lectura de integración. Detalle normativo y observabilidad: **`docs/CONTRATO_HTTP_V1_1.md`** en waseller-crew (§4.2 observabilidad, `LLM_SHADOW_COMPARE_TIMEOUT_MS`).

| Área | waseller-crew |
|------|----------------|
| **HTTP** | `POST /shadow-compare` y `POST /v1/shadow-compare` — mismo handler, mismo `ShadowCompareRequest` / respuesta. |
| **Pydantic** | `model_config = ConfigDict(extra="ignore")` — campos futuros de Waseller no rompen el POST. |
| **Opcionales** | `stockTable` (≤500), `businessProfileSlug`, **`inventoryNarrowingNote`** (Waseller puede enviarlo cuando aplica), `recentMessages`, `phone`, ids, etc. |
| **Auth** | `SHADOW_COMPARE_SECRET` + `SHADOW_COMPARE_REQUIRE_AUTH` (p. ej. `Depends(check_shadow_compare_bearer)`). |
| **Respuesta** | Instrucciones al LLM para `draftReply` no vacío en modo primary; si el crew devuelve vacío y el baseline tiene `draftReply`, enriquecimiento desde baseline + log **`shadow_compare_empty_draft_filled_from_baseline`**. `nextAction` sigue coaccionándose a enums válidos. |
| **Agente** | Sin inventar catálogo; `stockTable` + baseline como contexto; `inventoryNarrowingNote` en bloque de misión; `businessProfileSlug` → `tenant_prompts/<slug>.txt`; reglas de seguimiento / anti-repetición en prompt. |
| **Ops** | Logs JSON (p. ej. `shadow_compare_completed`, `shadow_compare_reject_kind`, `crew_failure` con `error_type` + `exc_info`); **`GET /health`**. |

### Waseller (este monorepo) — rutas que POSTean al crew

Con `LLM_SHADOW_COMPARE_URL` definida: **`conversation-orchestrator.worker`** (ruta orquestada) y **`lead.worker`** en la ruta directa sin `llmDecision` llaman a `logShadowExternalCompareIfConfigured` / `tryWasellerCrewPrimaryReplacement` y persisten trazas en `llm_traces` cuando corresponde.

---

## 8. waseller-crew — cómo subir aún más la calidad de leads (recomendaciones)

Waseller ya envía `recentMessages`, `stockTable`, `inventoryNarrowingNote` y baseline recortado; el **crew** puede mejorar respuestas sin cambiar el contrato HTTP, ajustando **prompt del agente**, **post-validación** o **segunda pasada** ligera.

| Tema | Qué hacer en waseller-crew |
|------|-----------------------------|
| **Anti-eco** | Instruir al LLM: si el **último** `recentMessages[].message` con `direction: "outgoing"` es muy parecido al `baselineDecision.draftReply` y el `incomingText` pide algo distinto (color, cantidad, otro artículo, catálogo), **no** repetir el mismo cierre; responder a la pregunta literal o pedir un dato mínimo. Opcional: heurística en código (similitud texto) antes de devolver `candidateDecision`. |
| **Seguimiento de variante** | Si `incomingText` menciona color/talle/“otra variante” y `stockTable` tiene **varias** filas, **listar** opciones reales desde la tabla (atributos + stock). Si hay **una** fila y `inventoryNarrowingNote` dice alcance único, decir con claridad que en el inventario recibido no hay otra combinación (sin inventar). |
| **Volumen / cantidad** | Parsear números en `incomingText`; si la cantidad pedida **supera** `availableStock` de la variante (o la suma del producto en `stockTable` si el crew agrega esa regla), reconocer el faltante, ofrecer reservar lo disponible y **derivación a humano** o “consultar reposición” según tono del `businessProfileSlug`. |
| **Catálogo amplio** | Si el cliente pide “otro producto”, “qué más hay” o “el catálogo” y el payload solo trae **un** producto en `stockTable`, el agente debe decir que **con el alcance de este turno** solo ve ese bloque y pedir **criterio de búsqueda** (palabras clave, uso), en lugar de inventar listados. |
| **`inventoryNarrowingNote`** | Darle **prioridad** sobre suposiciones del baseline cuando el mensaje del cliente amplía el alcance (multi-producto RAG vs producto único). |
| **Modo primary** | Reforzar en system prompt que `draftReply` es lo que **ve el cliente** en WhatsApp: tono comercial breve, español rioplatense si el slug/rubro lo indica, y **CTA** claro (reservar, medidas, derivación). |
| **Observabilidad** | Log estructurado cuando se detecte “baseline ignorado por mismatch con incoming” o “eco corregido” para afinar prompts con datos reales. |

Copiar esta tabla al backlog de **waseller-crew** (`docs/CONTRATO_HTTP_V1_1.md` o README del agente) mantiene alineación con lo que Waseller ya optimiza en `lead.worker` / orquestador.
