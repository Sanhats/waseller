# Decisión de runtime: CrewAI (Python) vs LangGraph (TS)

## Contexto del monorepo

- Orquestación operativa: **Node.js** (`apps/workers`), colas **BullMQ**, persistencia **Prisma**.
- El “equipo de agentes” actual ya está modelado como servicios encadenados (intérprete → decisor → verificador), no como un framework de agentes.

## Opción A — Microservicio Python con CrewAI

**Cuándo conviene:** el equipo domina Python, queréis iterar rápido con roles/tareas Crew, o reutilizáis tooling del ecosistema Python.

**Encaje técnico:** el servicio expone HTTP (o cola dedicada) con entrada/salida alineada a [`LlmOrchestrationJobV1`](../../packages/queue/src/contracts.ts) y validación vía [`external-agent-contract`](../../packages/queue/src/external-agent-contract.ts). Los workers TS siguen siendo la única pieza que escribe en Prisma, envía WhatsApp y aplica guardrails finales.

**Operación:** segundo despliegue, monitorización de latencia entre procesos, versionado del contrato JSON compartido.

## Opción B — LangGraph (u orquestación explícita) en TypeScript

**Cuándo conviene:** un solo runtime, control fino del grafo (ramas, reintentos, checkpoints), menos fricción DevOps.

**Encaje técnico:** sustituir o envolver la secuencia en `conversation-orchestrator.worker.ts` manteniendo los mismos tipos de salida y trazas.

## Recomendación por defecto para Waseller

1. Corto plazo: mantener el pipeline TS actual; usar **shadow** + `LLM_SHADOW_COMPARE_URL` para evaluar un servicio Crew **sin** cambiar el texto que recibe el cliente desde el LLM.
2. Medio plazo: si la comparación en trazas justifica coste y equipo, **microservicio Python Crew** solo para la fase “candidato”; si el equipo prefiere un solo lenguaje, **LangGraph JS** dentro de workers.

## Criterios de elección (checklist)

| Criterio | CrewAI (Python) | LangGraph (TS) |
|----------|------------------|----------------|
| Mismo repo/build que workers | No | Sí |
| Prototipo multi-rol rápido | Muy bueno | Bueno con más código inicial |
| Latencia extra (HTTP) | Sí | No |
| Human-in-the-loop / checkpoints | Posible | Nativo en LangGraph |

Esta decisión es reversible si el contrato JSON (`LlmDecisionV1` / `ConversationInterpretationV1`) permanece estable.
