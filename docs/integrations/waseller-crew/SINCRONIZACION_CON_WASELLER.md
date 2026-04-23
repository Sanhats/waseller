# Sincronización waseller-crew ↔ Waseller (TypeScript)

Este documento sirve para **verificar** que el servicio Python **waseller-crew** está alineado con el comportamiento y los contratos que Waseller usa hoy en producción. Actualizalo cuando cambien enums, payloads HTTP o tablas relevantes.

## 1. Superficie HTTP

| Aspecto | En Waseller | Comprobar en crew |
|--------|-------------|-------------------|
| URL | `LLM_SHADOW_COMPARE_URL` (workers) | Misma ruta y método `POST` |
| Auth opcional | `Authorization: Bearer` si `LLM_SHADOW_COMPARE_SECRET` / `SHADOW_COMPARE_SECRET` | Misma validación |
| Timeout cliente | `LLM_SHADOW_COMPARE_TIMEOUT_MS` (máx. 120000) | Respuesta estable por debajo |
| Cuerpo | `kind: waseller.shadow_compare.v1`, `schemaVersion: 1` | Parser compatible (`extra = "ignore"` recomendado) |

Referencia detallada de campos: [CONTRATO_V1_1.md](./CONTRATO_V1_1.md).

## 2. Tipos canónicos (fuente de verdad)

| Artefacto | Ubicación en Waseller |
|-----------|------------------------|
| Interpretación | `ConversationInterpretationV1` en `packages/queue/src/contracts.ts` |
| Decisión / reply | `LlmDecisionV1` en el mismo archivo |
| Validación JSON externo | `packages/queue/src/external-agent-contract.ts` (`parseExternalConversationInterpretation`, `parseExternalLlmDecision`) |
| JSON Schema export | `conversationInterpretationV1JsonSchema`, `llmDecisionV1JsonSchema` en el mismo módulo |

**Checklist:** los literales de `ConversationNextActionV1` y `ConversationStageV1` que acepta Waseller deben coincidir con los del crew (sin sinónimos ni valores legacy).

## 3. Pipeline de workers (orden real)

1. **Ingesta** → cola `incoming_messages` (`IncomingMessageJobV1`).
2. **`message-processor.worker`** — matcher, lead en Prisma, reglas; con URL de crew y delegación activa encola **siempre** `llmOrchestration`.
3. **`conversation-orchestrator.worker`** — en modo delegación al crew: stub de interpretación + baseline mínimo + **POST** al crew (`tryWasellerCrewPrimaryReplacement`); verificador y guardrails sobre el `draftReply` devuelto.
4. **`lead.worker`** — efectos deterministas (p. ej. Mercado Pago, reservas), armado del mensaje al cliente y cola `outgoing`.
5. **`sender.worker`** — envío al canal.

Documento de alto nivel: [`../../architecture/agent-pipeline.md`](../../architecture/agent-pipeline.md).

## 4. Datos de negocio que Waseller inyecta al POST

| Bloque | Origen en Waseller | Notas |
|--------|---------------------|--------|
| `tenantBrief` | `tenant_knowledge` → perfil normalizado (`buildCrewTenantBriefFromProfile`) | Tono, envíos, pagos, políticas (sin secretos) |
| `tenantCommercialContext` | Derivado del brief | Texto plano opcional para prompts |
| `tenantRuntimeContext` | Fila `tenants` + integraciones (sin secretos) | Ver `loadCrewTenantRuntimeContextForCrewPayload` en `shadow-compare.service.ts` |
| `ruleInterpretation` / `interpretation` | Processor u orquestador | El crew puede fusionar `candidateInterpretation` |
| `baselineDecision` | LLM interno o stub en modo crew-only | El crew devuelve `candidateDecision` |
| `recentMessages` | Hasta 8 mensajes, orden cronológico | Incluye enriquecido del último reply bot si aplica |
| `stockTable` / RAG productos | SQL / catálogo | Prioridad documentada en contrato v1.1 |
| `activeOffer`, `memoryFacts`, `etapa` | Job + memoria de conversación | Opcionales v1.1 |

Si el **dashboard** marca perfil incompleto (`crewCommercialContextComplete === false`), Waseller **sigue** llamando al crew cuando hay URL; el comerciante ve un aviso fijo para completar tono y entregas y mejorar la calidad del contexto.

## 5. Variables de entorno críticas (workers)

| Variable | Efecto |
|----------|--------|
| `LLM_SHADOW_COMPARE_URL` | Habilita POST al crew |
| `WASELLER_CREW_DELEGATE_CONVERSATION=false` | Opt-out: no asumir delegación total solo por URL |
| `WASELLER_CREW_PRIMARY` / `WASELLER_CREW_SOLE_MODE` | Modos explícitos legacy; ver README del integración |
| `LLM_SHADOW_MODE` | Si `true`, el cliente igual puede ver texto del crew cuando la delegación está activa (ver `lead.worker` / orquestador) |

## 6. Prueba de humo cruzada

1. Fixture de ejemplo: [`fixtures/request.v1_1.example.json`](./fixtures/request.v1_1.example.json).
2. En Waseller: job real con `correlationId` y traza en `LlmTrace` / eventos de respuesta bot.
3. Comparar `draftReply` y `nextAction` del crew con lo persistido tras guardrails.

## 7. Cambios que obligan a revisar este documento

- Nuevos valores en `LeadStatus`, intents comerciales, o acciones `ConversationNextActionV1`.
- Cambios en `TenantBusinessProfile` o en `isTenantCrewCommercialContextComplete` (`packages/shared/src/tenant-business-profile.ts`).
- Nuevos campos obligatorios en el POST shadow-compare.
- Cambio de versión `JOB_SCHEMA_VERSION` o `schemaVersion` del payload HTTP.

---

**Responsabilidad:** mantener este archivo y `CONTRATO_V1_1.md` en sync entre el repo **waseller** y el repo **waseller-crew** al mergear cambios de contrato.
