# Servicio externo CrewAI (shadow compare) para Waseller

Esta carpeta en Waseller contiene todo el paquete para el **otro repo**:

| Archivo | Uso |
|---------|-----|
| [`README.md`](./README.md) | Contrato HTTP, enums, checklist, despliegue (este archivo). |
| [`pyproject.toml.example`](./pyproject.toml.example) | Copiar como `pyproject.toml` y ajustar nombre/versions de `crewai`. |
| [`.env.example`](./.env.example) | Variables del servicio Python. |
| [`fixtures/request.example.json`](./fixtures/request.example.json) | Body mínimo (v1). |
| [`fixtures/request.v1_1.example.json`](./fixtures/request.v1_1.example.json) | Body con opcionales v1.1 (`phone`, ids, `recentMessages`, `tenantBrief`, `tenantRuntimeContext`, …). |
| [`fixtures/request.mesa_colores.json`](./fixtures/request.mesa_colores.json) | Diálogo **mesa → «¿Qué colores tenés?»** (`recentMessages`, `activeOffer`, `memoryFacts`, `etapa`, `stockTable`, …) para smoke / alinear con el test del repo **waseller-crew**. |
| [`IMPLEMENTACION_MINIMA.md`](./IMPLEMENTACION_MINIMA.md) | Esqueleto FastAPI + stub `run_crew()` y `curl` de prueba. |
| [`CONTRATO_V1_1.md`](./CONTRATO_V1_1.md) | Propuesta coordinada: body opcional + Bearer + ejemplos JSON (para PR en Waseller y alinear waseller-crew). |
| [`SINCRONIZACION_CON_WASELLER.md`](./SINCRONIZACION_CON_WASELLER.md) | Checklist de alineación waseller-crew ↔ workers, contratos y datos enviados en el POST. |

Podés copiar **toda la carpeta** `docs/integrations/waseller-crew/` al nuevo repositorio (como `docs/` o raíz del proyecto Python).

Este documento es **autocontenido** para implementar el microservicio con **`uv`**. Waseller llama a este servicio cuando:

- `LLM_SHADOW_COMPARE_URL` apunta a tu URL (HTTPS en producción).
- **`WASELLER_CREW_PRIMARY=true`** (opcional): el crew **sustituye** la decisión interna en el orquestador (misma URL y contrato); no se envía un POST adicional solo para comparar en ese turno. Ver `CONTRATO_V1_1.md`.
- **`WASELLER_CREW_SOLE_MODE=true`** (opcional): **orquestador** — no intérprete OpenAI ni `SelfHostedLlmService.decide`; baseline stub + `ruleInterpretation` del processor cuando aplica; se fusiona `candidateInterpretation` del crew si viene. **Lead worker** (ruta directa sin `llmDecision`) — el POST al crew usa interpretación/baseline stub (el texto de plantillas locales no es el baseline enviado al crew); sin respuesta crew válida, el mensaje al cliente es el template de handoff. Requiere `LLM_SHADOW_COMPARE_URL`; **no** hace falta `WASELLER_CREW_PRIMARY`.
- **`WASELLER_CREW_ORCHESTRATE_FIRST=true`** (opcional): con LLM habilitado y `LLM_SHADOW_COMPARE_URL` + primary, el **message-processor** manda también los turnos con variante resuelta al **orquestador** (intérprete + RAG + crew), no solo al lead. Ver `CONTRATO_V1_1.md` §2 y `message-processor.worker.ts`.
- El job de orquestación va en **`executionMode: "shadow"`** o **`active`** (ver `LlmRolloutService` / tenant / `LLM_SHADOW_MODE`).

Referencia en Waseller:

- Cliente HTTP: [`apps/workers/src/services/shadow-compare.service.ts`](../../../apps/workers/src/services/shadow-compare.service.ts)
- Validación de respuesta: [`packages/queue/src/external-agent-contract.ts`](../../../packages/queue/src/external-agent-contract.ts)

---

## Requisitos previos

| Requisito | Notas |
|-----------|--------|
| **Python** | 3.11 o 3.12 recomendado (CrewAI / deps suelen seguir estas versiones). |
| **uv** | Instalación: [documentación oficial de uv](https://docs.astral.sh/uv/getting-started/installation/). En Windows: instalador o `pip install uv`. |
| **API de LLM** | `OPENAI_API_KEY` u otro proveedor compatible con lo que use CrewAI en tu proyecto. |
| **Red** | URL pública HTTPS (Railway, Fly.io, Cloud Run, etc.) accesible **desde los workers** de Waseller. |
| **Seguridad** | `SHADOW_COMPARE_SECRET` en el crew + `LLM_SHADOW_COMPARE_SECRET` o `SHADOW_COMPARE_SECRET` en workers Waseller; Bearer cuando el secret está definido. Ver `CONTRATO_V1_1.md`. |

---

## Contrato HTTP (Waseller → tu servicio)

### Método y cabeceras

- **POST** a la URL exacta configurada en `LLM_SHADOW_COMPARE_URL` (puede ser `https://host/shadow-compare` o la raíz si así lo configurás).
- **Content-Type:** `application/json`
- **Authorization (opcional):** si en workers está definido **`LLM_SHADOW_COMPARE_SECRET`** o **`SHADOW_COMPARE_SECRET`** (no vacío), Waseller envía `Authorization: Bearer <secret>`. El valor debe coincidir con **`SHADOW_COMPARE_SECRET`** en waseller-crew.
- **Timeout del cliente Waseller:** `LLM_SHADOW_COMPARE_TIMEOUT_MS` (default **30000** ms, máximo 120000). Tu servicio debe responder por debajo de ese valor o Waseller abortará la petición (la traza guardará error de red/abort).

### Cuerpo JSON (request)

Detalle completo v1.1: [`CONTRATO_V1_1.md`](./CONTRATO_V1_1.md). Resumen:

| Campo | Tipo | Obligatoriedad |
|--------|------|----------------|
| `schemaVersion` | `number` | Siempre **1**. |
| `kind` | `string` | **`waseller.shadow_compare.v1`**. |
| `tenantId`, `leadId`, `incomingText`, `interpretation`, `baselineDecision` | — | Obligatorios (como antes). |
| `phone` | `string` | Opcional (número de contacto del job). |
| `correlationId`, `messageId` | `string` | Opcionales. |
| `conversationId` | `string` | Opcional (si el job trae conversación). |
| `recentMessages` | `{ direction, message }[]` | Opcional; hasta **8** mensajes, orden cronológico (más antiguo primero). |
| `stockTable`, `businessProfileSlug`, `tenantBrief`, `tenantCommercialContext`, `inventoryNarrowingNote`, `etapa`, `activeOffer`, `memoryFacts`, `publicCatalogSlug`, `publicCatalogBaseUrl`, `tenantRuntimeContext` | ver `CONTRATO_V1_1.md` §1 y §1.1 | Opcionales v1.1; el crew usa `extra="ignore"` para campos desconocidos. `tenantBrief` es objeto en el wire Waseller (el crew puede acotarlo a ~2500 caracteres al volcar al kickoff). `tenantRuntimeContext`: snapshot ordenado de fila tenant + políticas LLM + integraciones de pago (sin secretos). `memoryFacts`: hasta **40** strings (≤**400** caracteres c/u). **`stockTable` tiene prioridad** sobre `activeOffer` / digests si hay conflicto (documentado en prompts del crew). **`publicCatalog*`:** Waseller los envía cuando el tenant tiene slug en BD y hay origen (`PUBLIC_CATALOG_BASE_URL` o `PUBLIC_API_BASE_URL`) para armar `…/tienda/<slug>`. |

#### `ConversationInterpretationV1` (resumen)

- `intent`: string  
- `confidence`: number  
- `entities`: objeto; valores: string | number | boolean | null | objeto plano string→string  
- `references`: array de `{ kind, value?, axis?, index?, confidence?, metadata? }`  
- `conversationStage?`: uno de los estados de conversación Waseller  
- `missingFields`: string[]  
- `nextAction`: uno de los valores de **ConversationNextActionV1** (lista abajo)  
- `source`: `"rules"` \| `"openai"`  
- `notes?`: string[]  

#### `LlmDecisionV1` (resumen)

- `intent`, `leadStage` (`discovery` \| `consideration` \| `decision` \| `handoff`), `confidence`, `entities`, `nextAction`, `reason`, `requiresHuman`, `recommendedAction`, `draftReply`, `handoffRequired`, `qualityFlags`, `source` (`llm` \| `fallback`)  
- Opcionales: `policyBand`, `executionMode`, `policy`, `verification`, `provider`, `model`  

#### Valores permitidos: `ConversationNextActionV1`

```
reply_only | ask_clarification | confirm_variant | offer_reservation | reserve_stock
| share_payment_link | suggest_alternative | handoff_human | close_lead | manual_review
```

#### Valores permitidos: `ConversationStageV1`

```
waiting_product | waiting_variant | variant_offered | waiting_reservation_confirmation
| reserved_waiting_payment_method | payment_link_sent | waiting_payment_confirmation | sale_confirmed
```

Si devolvés `candidateInterpretation.nextAction` o `conversationStage`, deben ser **exactamente** uno de los literales anteriores (Waseller valida con sets fijos).

---

## Respuesta JSON (tu servicio → Waseller)

Waseller parsea el cuerpo con `parseShadowCompareHttpResponse`. Debe ser un **objeto JSON** (no HTML ni texto plano).

### Forma válida (mínima)

```json
{}
```

Válido pero poco útil: no habrá `candidateDecision` y el diff quedará como “skipped”.

### Forma recomendada (comparación útil)

```json
{
  "candidateDecision": {
    "draftReply": "Texto propuesto por Crew…",
    "intent": "consultar_precio",
    "nextAction": "reply_only",
    "recommendedAction": "reply_only",
    "confidence": 0.85,
    "reason": "Breve justificación interna"
  },
  "candidateInterpretation": {
    "intent": "consultar_precio",
    "confidence": 0.9,
    "nextAction": "reply_only",
    "source": "openai"
  }
}
```

**Reglas:**

- `candidateDecision` y `candidateInterpretation` son **opcionales**.
- Tipos estrictos: `draftReply` string, `confidence` number, `nextAction` string en el enum, etc. Si un campo tiene tipo incorrecto, Waseller marca la respuesta como inválida y guarda `issues` en la traza.
- `candidateInterpretation`, si se envía, se valida de forma **parcial**: si incluís `source`, debe ser `rules` o `openai`; `nextAction` y `conversationStage` deben ser literales válidos si están presentes.

### Código HTTP

Waseller **no** exige `2xx` para parsear: lee el body igualmente. Igual conviene devolver **`200 OK`** con JSON cuando el crew terminó bien, y **`4xx/5xx`** solo si querés dejar constancia en `httpStatus` (se persiste en la traza).

---

## Qué hace Waseller con tu respuesta

1. Si el JSON es inválido → traza `shadow_compare` con `error` y/o `issues`.  
2. Si es válido → calcula `diff` (`draftReplyEqual`, `intentMatch`, …) comparando `baselineDecision` con `candidateDecision` (cuando corre el flujo de shadow-compare).  
3. **`WASELLER_CREW_PRIMARY=true`:** una llamada al mismo endpoint puede **reemplazar** la decisión interna antes del verificador; traza `crew_primary`. Ver `CONTRATO_V1_1.md`.  
4. **Shadow (rollout) / lead directo:** si el mensaje va por **lead worker** sin pasar por el orquestador, el lead igual puede llamar al crew (primary / shadow) con el mismo contrato HTTP. Si **`WASELLER_CREW_ORCHESTRATE_FIRST=true`**, muchos de esos turnos **sí** pasan primero por el orquestador y el crew recibe también el contexto del intérprete interno.

---

## Crear el repo con `uv` (paso a paso)

En una carpeta vacía (fuera de Waseller):

```bash
uv init --package waseller-crew --python 3.12
cd waseller-crew
```

Editá `pyproject.toml` y añadí dependencias (ver archivo de ejemplo en esta carpeta: [`pyproject.toml.example`](./pyproject.toml.example)).

Sincronizar entorno:

```bash
uv sync
```

Estructura sugerida:

```
waseller-crew/
  pyproject.toml
  README.md                 # copia de este doc o resumen + enlace
  .env.example
  src/
    crew_shadow_crewai/
      __init__.py
      main.py                 # uvicorn: app FastAPI
      routes.py               # POST /shadow-compare
      models.py               # Pydantic: ShadowCompareRequest, ShadowCompareResponse
      crew_app.py             # Crew + tasks + agents
```

Arranque local:

```bash
uv run uvicorn crew_shadow_crewai.main:app --host 0.0.0.0 --port 8080
```

Probar con `curl` usando un JSON de ejemplo guardado en `fixtures/request.json`.

---

## Variables de entorno (servicio Python)

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `OPENAI_API_KEY` | Sí (si usás OpenAI con Crew) | Clave del proveedor LLM. |
| `PORT` | No | Puerto del servidor (p. ej. 8080). Plataformas suelen inyectar `PORT`. |
| `SHADOW_COMPARE_SECRET` | Recomendada en prod | Mismo valor que workers; ver `CONTRATO_V1_1.md`. |
| `SHADOW_COMPARE_REQUIRE_AUTH` | No | `true` en prod si el endpoint es público. |
| `LOG_LEVEL` | No | `INFO`, `DEBUG`, etc. |

Observabilidad y detalle de respuesta (enriquecimiento de `draftReply` vacío, logs): ver **`docs/CONTRATO_HTTP_V1_1.md`** en el repo **waseller-crew** (§4.2 y resto del contrato).

En **Waseller (workers)** ya existen:

- `LLM_SHADOW_COMPARE_URL` — URL de tu `POST`.
- `LLM_SHADOW_COMPARE_TIMEOUT_MS` — timeout del fetch.

---

## CrewAI: enfoque mínimo

1. **Un agente “redactor”** que reciba en contexto: `incomingText`, `interpretation`, `baselineDecision` y genere un JSON con `draftReply`, `intent`, `nextAction`, `recommendedAction`, `confidence`, `reason`.  
2. **Opcional: agente “crítico”** que revise el JSON y lo ajuste (proceso secuencial CrewAI).  
3. **Salida:** serializar **solo** el objeto que cumple el contrato de respuesta (mejor con Pydantic `model_dump()` para tipos correctos).

No intentes llamar a Prisma ni a Redis desde este servicio en la fase shadow: el contrato es **stateless** salvo lo que vos agregues (cache, logs, etc.).

---

## Despliegue

- Contenedor Docker con `CMD` tipo `uv run uvicorn ...` o `uv run gunicorn` si preferís.  
- Healthcheck: `GET /health` → `200` con `{"ok":true}`.  
- Waseller solo usa **POST** a la URL configurada; si montás el app en `/`, la variable sería `https://tu-dominio/` (o path explícito si el worker apunta a `/shadow-compare`).

---

## Checklist operativo antes de enchufar producción

- [ ] **Body:** `schemaVersion`, `kind`, `tenantId`, `leadId`, `incomingText`, `interpretation`, `baselineDecision` correctos; opcionales según §1 del contrato (`recentMessages`, `stockTable`, `inventoryNarrowingNote`, `tenantBrief`, `tenantCommercialContext`, `etapa`, `activeOffer`, `memoryFacts`, …).  
- [ ] **Respuesta:** `200` + JSON con `candidateDecision.draftReply` **no vacío** en modo útil (primary); baseline de respaldo si el crew devuelve borrador vacío (ver `docs/CONTRATO_HTTP_V1_1.md` §4.2 en repo crew).  
- [ ] **Timeouts:** `POST` por debajo de `LLM_SHADOW_COMPARE_TIMEOUT_MS` (workers); subir timeout si `stockTable` es grande.  
- [ ] **Bearer:** `SHADOW_COMPARE_SECRET` (crew) = `LLM_SHADOW_COMPARE_SECRET` o `SHADOW_COMPARE_SECRET` (workers); `SHADOW_COMPARE_REQUIRE_AUTH=true` en prod si el endpoint es público.  
- [ ] **Prueba mesa → colores:** `curl` / test con [`fixtures/request.mesa_colores.json`](./fixtures/request.mesa_colores.json) (esta carpeta) o el homónimo en **waseller-crew** → respuesta lista colores reales desde `stockTable`, sin repetir solo el cierre del baseline.  
- [ ] `nextAction` / `conversationStage` / `source` dentro de enums permitidos.  
- [ ] HTTPS y rate limit / coste por `tenantId`.

---

## Waseller monorepo — orquestador primero (opcional)

- Con **`WASELLER_CREW_ORCHESTRATE_FIRST=true`** (y primary + URL + LLM habilitado), el routing en `apps/workers/src/message-processor.worker.ts` **enciola el orquestador** también cuando antes solo iba al lead por variante resuelta. Sin ese flag, el comportamiento histórico se mantiene.
