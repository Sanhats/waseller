"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpsService = void 0;
const common_1 = require("@nestjs/common");
const src_1 = require("../../../../../packages/queue/src");
const src_2 = require("../../../../../packages/db/src");
const src_3 = require("../../../../../packages/shared/src");
const DEFAULT_PLAYBOOKS = [
    {
        intent: "precio",
        variant: "A",
        template: "{product_name} está en ${price}. Tenemos {available_stock} unidad(es) disponibles. ¿Querés que te reserve una?",
        weight: 50,
        isActive: true
    },
    {
        intent: "precio",
        variant: "B",
        template: "El precio de {product_name} es ${price}. Hay {available_stock} unidad(es) en stock. Si querés, la dejo reservada ahora.",
        weight: 50,
        isActive: true
    },
    {
        intent: "stock",
        variant: "A",
        template: "Sí, tenemos {product_name}. Quedan {available_stock} unidad(es). ¿Querés avanzar con la reserva?",
        weight: 50,
        isActive: true
    },
    {
        intent: "stock",
        variant: "B",
        template: "Te confirmo stock de {product_name}: {available_stock} unidad(es) disponibles. ¿Te aparto una?",
        weight: 50,
        isActive: true
    },
    {
        intent: "objecion",
        variant: "A",
        template: "Entiendo. Si querés, te comparto una alternativa de {product_name} que se ajuste mejor a lo que buscás.",
        weight: 50,
        isActive: true
    },
    {
        intent: "objecion",
        variant: "B",
        template: "Perfecto, gracias por el contexto. Puedo recomendarte otra opción de {product_name} según tu presupuesto.",
        weight: 50,
        isActive: true
    },
    {
        intent: "cierre",
        variant: "A",
        template: "Excelente, ya tenemos {product_name} listo. Precio ${price}. ¿Te paso el link de pago para cerrar?",
        weight: 50,
        isActive: true
    },
    {
        intent: "cierre",
        variant: "B",
        template: "¡Genial! Reservamos {product_name}. Son ${price}. Si querés, ahora mismo te envío el link de pago.",
        weight: 50,
        isActive: true
    }
];
const DEFAULT_RESPONSE_TEMPLATES = [
    {
        key: "payment_report_received",
        template: "Gracias por avisar. Registramos el pago reportado de {product_name}. Un asesor lo valida y te confirmamos por este medio en breve.",
        isActive: true
    },
    {
        key: "payment_cash_available",
        template: "Perfecto, tu reserva de {product_name} está activa. Podemos tomar pago en efectivo al retiro. Si querés, te derivamos con un asesor para coordinar entrega y cierre.",
        isActive: true
    },
    {
        key: "payment_options_overview",
        template: "Para {product_name} podés pagar con Mercado Pago (link) o en efectivo al retiro. Precio ${price}. ¿Querés que te reserve una y avanzamos con la opción que prefieras?",
        isActive: true
    },
    {
        key: "orchestrator_guardrail_handoff",
        template: "Quiero asegurarme de darte la mejor respuesta. Te paso con un asesor para confirmar los detalles y ayudarte a cerrar la compra.",
        isActive: true
    }
];
const DEFAULT_TENANT_KNOWLEDGE = src_3.DEFAULT_TENANT_BUSINESS_PROFILE;
let OpsService = class OpsService {
    resolveRangeStart(range) {
        if (range === "all")
            return null;
        const now = new Date();
        if (range === "today") {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            return start;
        }
        if (range === "30d") {
            return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    async queueStats(queue) {
        const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused");
        return {
            queue: queue.name,
            counts: {
                waiting: counts.waiting ?? 0,
                active: counts.active ?? 0,
                completed: counts.completed ?? 0,
                failed: counts.failed ?? 0,
                delayed: counts.delayed ?? 0,
                paused: counts.paused ?? 0
            }
        };
    }
    async getQueuesOverview() {
        const queues = await Promise.all([
            this.queueStats(src_1.incomingQueue),
            this.queueStats(src_1.llmOrchestrationQueue),
            this.queueStats(src_1.leadProcessingQueue),
            this.queueStats(src_1.outgoingQueue),
            this.queueStats(src_1.stockSyncQueue)
        ]);
        return {
            generatedAt: new Date().toISOString(),
            queues
        };
    }
    async getFunnelMetrics(tenantId, range = "7d") {
        const rangeStart = this.resolveRangeStart(range);
        const leadsByStatus = rangeStart
            ? (await src_2.prisma.$queryRaw `
          select status::text as status, count(*)::int as count
          from public.leads
          where tenant_id::text = ${tenantId}
            and updated_at >= ${rangeStart}
          group by status
        `)
            : (await src_2.prisma.$queryRaw `
          select status::text as status, count(*)::int as count
          from public.leads
          where tenant_id::text = ${tenantId}
          group by status
        `);
        const byStatus = new Map(leadsByStatus.map((row) => [row.status, Number(row.count)]));
        const contactado = Array.from(byStatus.values()).reduce((acc, curr) => acc + curr, 0);
        const vendido = byStatus.get("vendido") ?? 0;
        const listoParaCobrar = (byStatus.get("listo_para_cobrar") ?? 0) + vendido;
        const interesado = (byStatus.get("interesado") ?? 0) + (byStatus.get("caliente") ?? 0) + listoParaCobrar;
        const responseRows = rangeStart
            ? (await src_2.prisma.$queryRaw `
          with per_phone as (
            select
              phone,
              min(case when direction = 'incoming' then created_at end) as first_incoming,
              min(case when direction = 'outgoing' then created_at end) as first_outgoing
            from public.messages
            where tenant_id::text = ${tenantId}
              and created_at >= ${rangeStart}
            group by phone
          )
          select coalesce(avg(extract(epoch from (first_outgoing - first_incoming))), 0)::float as avg_seconds
          from per_phone
          where first_incoming is not null
            and first_outgoing is not null
            and first_outgoing >= first_incoming
        `)
            : (await src_2.prisma.$queryRaw `
          with per_phone as (
            select
              phone,
              min(case when direction = 'incoming' then created_at end) as first_incoming,
              min(case when direction = 'outgoing' then created_at end) as first_outgoing
            from public.messages
            where tenant_id::text = ${tenantId}
            group by phone
          )
          select coalesce(avg(extract(epoch from (first_outgoing - first_incoming))), 0)::float as avg_seconds
          from per_phone
          where first_incoming is not null
            and first_outgoing is not null
            and first_outgoing >= first_incoming
        `);
        const avgFirstResponseSeconds = Number(responseRows[0]?.avg_seconds ?? 0);
        const reservationRows = rangeStart
            ? (await src_2.prisma.$queryRaw `
          select count(distinct phone)::int as reserved_phones
          from public.stock_movements
          where tenant_id::text = ${tenantId}
            and movement_type = 'reserve'
            and phone is not null
            and created_at >= ${rangeStart}
        `)
            : (await src_2.prisma.$queryRaw `
          select count(distinct phone)::int as reserved_phones
          from public.stock_movements
          where tenant_id::text = ${tenantId}
            and movement_type = 'reserve'
            and phone is not null
        `);
        const reservedPhones = Number(reservationRows[0]?.reserved_phones ?? 0);
        const reservationRate = contactado > 0 ? reservedPhones / contactado : 0;
        const closeRate = contactado > 0 ? vendido / contactado : 0;
        return {
            generatedAt: new Date().toISOString(),
            range,
            funnel: {
                contactado,
                interesado,
                listoParaCobrar,
                vendido,
                avgFirstResponseSeconds,
                reservationRate,
                closeRate
            }
        };
    }
    async getPlaybooks(tenantId) {
        try {
            const rows = (await src_2.prisma.$queryRaw `
        select
          id::text as id,
          intent,
          variant,
          template,
          weight::int as weight,
          is_active as "isActive"
        from public.bot_playbooks
        where tenant_id::text = ${tenantId}
        order by intent asc, variant asc
      `);
            if (rows.length > 0) {
                return { generatedAt: new Date().toISOString(), playbooks: rows };
            }
        }
        catch {
            // Si la tabla no existe aún, devolvemos defaults sin romper la UI.
        }
        return {
            generatedAt: new Date().toISOString(),
            playbooks: DEFAULT_PLAYBOOKS.map((playbook, idx) => ({
                id: `default-${idx}`,
                intent: playbook.intent,
                variant: playbook.variant,
                template: playbook.template,
                weight: playbook.weight,
                isActive: playbook.isActive
            }))
        };
    }
    async savePlaybooks(tenantId, payload) {
        const normalized = payload
            .map((item) => ({
            intent: String(item.intent ?? "").trim().toLowerCase(),
            variant: String(item.variant ?? "").trim().toUpperCase(),
            template: String(item.template ?? "").trim(),
            weight: Math.max(1, Number(item.weight ?? 50)),
            isActive: item.isActive !== false
        }))
            .filter((item) => item.intent && item.variant && item.template);
        const intents = Array.from(new Set(normalized.map((item) => item.intent)));
        if (normalized.length === 0 || intents.length === 0) {
            return { saved: 0 };
        }
        try {
            await src_2.prisma.$executeRaw `
        delete from public.bot_playbooks
        where tenant_id::text = ${tenantId}
          and intent = any(${intents}::text[])
      `;
            for (const item of normalized) {
                await src_2.prisma.$executeRaw `
          insert into public.bot_playbooks (tenant_id, intent, variant, template, weight, is_active)
          values (
            cast(${tenantId} as uuid),
            ${item.intent},
            ${item.variant},
            ${item.template},
            ${item.weight},
            ${item.isActive}
          )
          on conflict (tenant_id, intent, variant)
          do update set
            template = excluded.template,
            weight = excluded.weight,
            is_active = excluded.is_active,
            updated_at = now()
        `;
            }
            return { saved: normalized.length };
        }
        catch {
            return { saved: 0 };
        }
    }
    async getResponseTemplates(tenantId) {
        try {
            const rows = (await src_2.prisma.$queryRaw `
        select
          id::text as id,
          key,
          template,
          is_active as "isActive",
          updated_at as "updatedAt"
        from public.bot_response_templates
        where tenant_id::text = ${tenantId}
        order by key asc
      `);
            if (rows.length > 0) {
                return {
                    generatedAt: new Date().toISOString(),
                    templates: rows.map((item) => ({
                        id: item.id,
                        key: item.key,
                        template: item.template,
                        isActive: item.isActive,
                        updatedAt: item.updatedAt.toISOString()
                    }))
                };
            }
        }
        catch {
            // Tabla opcional para compatibilidad backward.
        }
        return {
            generatedAt: new Date().toISOString(),
            templates: DEFAULT_RESPONSE_TEMPLATES.map((item, idx) => ({
                id: `default-template-${idx}`,
                key: item.key,
                template: item.template,
                isActive: item.isActive,
                updatedAt: new Date().toISOString()
            }))
        };
    }
    async saveResponseTemplates(tenantId, payload) {
        const normalized = payload
            .map((item) => ({
            key: String(item.key ?? "").trim().toLowerCase(),
            template: String(item.template ?? "").trim(),
            isActive: item.isActive !== false
        }))
            .filter((item) => item.key && item.template);
        if (normalized.length === 0)
            return { saved: 0 };
        try {
            for (const item of normalized) {
                await src_2.prisma.$executeRaw `
          insert into public.bot_response_templates (tenant_id, key, template, is_active)
          values (cast(${tenantId} as uuid), ${item.key}, ${item.template}, ${item.isActive})
          on conflict (tenant_id, key)
          do update set
            template = excluded.template,
            is_active = excluded.is_active,
            updated_at = now()
        `;
            }
            return { saved: normalized.length };
        }
        catch {
            return { saved: 0 };
        }
    }
    async getTenantKnowledge(tenantId) {
        const tenant = await src_2.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { name: true, publicCatalogSlug: true }
        });
        const tenantName = String(tenant?.name ?? "").trim();
        const publicCatalogSlug = typeof tenant?.publicCatalogSlug === "string" && tenant.publicCatalogSlug.trim()
            ? tenant.publicCatalogSlug.trim()
            : null;
        try {
            const rows = (await src_2.prisma.$queryRaw `
        select profile, business_category as "businessCategory", business_labels as "businessLabels"
        from public.tenant_knowledge
        where tenant_id::text = ${tenantId}
        limit 1
      `);
            const profile = rows[0]?.profile;
            if (profile) {
                const normalized = (0, src_3.normalizeTenantBusinessProfile)({
                    ...profile,
                    businessCategory: rows[0]?.businessCategory,
                    businessLabels: rows[0]?.businessLabels
                });
                const knowledge = {
                    ...normalized,
                    businessName: normalized.businessName?.trim() || tenantName || undefined
                };
                return {
                    tenantId,
                    tenantName,
                    publicCatalogSlug,
                    persisted: true,
                    crewCommercialContextComplete: (0, src_3.isTenantCrewCommercialContextComplete)(knowledge),
                    knowledge
                };
            }
        }
        catch {
            // Compatibilidad con DBs sin tabla tenant_knowledge.
        }
        const fallback = (0, src_3.normalizeTenantBusinessProfile)({
            ...DEFAULT_TENANT_KNOWLEDGE,
            businessName: tenantName || undefined
        });
        return {
            tenantId,
            tenantName,
            publicCatalogSlug,
            persisted: false,
            crewCommercialContextComplete: (0, src_3.isTenantCrewCommercialContextComplete)(fallback),
            knowledge: fallback
        };
    }
    async updateTenantKnowledge(tenantId, input) {
        if (input.presetCategory && !Object.prototype.hasOwnProperty.call(src_3.BUSINESS_PRESETS, input.presetCategory)) {
            throw new common_1.BadRequestException("presetCategory inválido");
        }
        if (input.knowledge !== undefined && (typeof input.knowledge !== "object" || input.knowledge === null)) {
            throw new common_1.BadRequestException("knowledge debe ser un objeto");
        }
        const tenant = await src_2.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { name: true }
        });
        const tenantName = String(tenant?.name ?? "").trim();
        const rawKnowledge = input.knowledge && typeof input.knowledge === "object"
            ? input.knowledge
            : undefined;
        const source = rawKnowledge
            ? {
                ...rawKnowledge,
                ...(input.presetCategory ? { businessCategory: input.presetCategory } : {}),
                businessName: String(rawKnowledge.businessName ?? "").trim() || tenantName || undefined
            }
            : input.presetCategory
                ? {
                    ...DEFAULT_TENANT_KNOWLEDGE,
                    ...src_3.BUSINESS_PRESETS[input.presetCategory],
                    businessCategory: input.presetCategory,
                    businessName: tenantName || undefined
                }
                : { ...DEFAULT_TENANT_KNOWLEDGE, businessName: tenantName || undefined };
        const knowledge = (0, src_3.normalizeTenantBusinessProfile)(source);
        try {
            await src_2.prisma.tenantKnowledge.upsert({
                where: { tenantId },
                create: {
                    tenantId,
                    businessCategory: knowledge.businessCategory,
                    businessLabels: knowledge.businessLabels,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    profile: knowledge
                },
                update: {
                    businessCategory: knowledge.businessCategory,
                    businessLabels: knowledge.businessLabels,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    profile: knowledge
                }
            });
        }
        catch {
            throw new common_1.BadRequestException("no se pudo guardar tenant_knowledge");
        }
        return {
            tenantId,
            knowledge
        };
    }
    getTenantKnowledgePresets() {
        const labelMap = {
            general: "General",
            indumentaria_calzado: "Indumentaria y Calzado",
            electronica: "Electrónica",
            hogar_deco: "Hogar y Deco",
            belleza_salud: "Belleza y Salud",
            repuestos_lubricentro: "Repuestos y lubricentro"
        };
        const categories = Object.keys(src_3.BUSINESS_PRESETS).map((id) => ({
            id,
            label: labelMap[id] ?? id,
            profile: (0, src_3.normalizeTenantBusinessProfile)({
                ...DEFAULT_TENANT_KNOWLEDGE,
                ...src_3.BUSINESS_PRESETS[id],
                businessCategory: id
            })
        }));
        return { categories };
    }
    async getTenantLlmSettings(tenantId) {
        const tenant = await src_2.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
                llmAssistEnabled: true,
                llmConfidenceThreshold: true,
                llmGuardrailsStrict: true,
                llmRolloutPercent: true,
                llmModelName: true
            }
        });
        const globalShadowMode = String(process.env.LLM_SHADOW_MODE ?? "true") === "true";
        const globalKillSwitch = String(process.env.LLM_KILL_SWITCH ?? "false") === "true";
        const globalAllowSensitive = String(process.env.LLM_ALLOW_SENSITIVE_ACTIONS ?? "false") === "true";
        const verifierRequired = String(process.env.LLM_VERIFIER_REQUIRED ?? "true") === "true";
        const minVerifierScore = Math.max(0, Math.min(1, Number(process.env.LLM_VERIFIER_MIN_SCORE ?? 0.65)));
        if (!tenant) {
            return {
                tenantId,
                settings: {
                    llmAssistEnabled: false,
                    llmConfidenceThreshold: 0.72,
                    llmGuardrailsStrict: true,
                    llmRolloutPercent: 0,
                    llmModelName: "self-hosted-default",
                    llmShadowMode: globalShadowMode,
                    llmKillSwitch: globalKillSwitch,
                    llmAllowSensitiveActions: globalAllowSensitive && !globalShadowMode,
                    verifierRequired,
                    minVerifierScore
                }
            };
        }
        return {
            tenantId,
            settings: {
                llmAssistEnabled: tenant.llmAssistEnabled,
                llmConfidenceThreshold: Number(tenant.llmConfidenceThreshold),
                llmGuardrailsStrict: tenant.llmGuardrailsStrict,
                llmRolloutPercent: tenant.llmRolloutPercent,
                llmModelName: tenant.llmModelName,
                llmShadowMode: globalShadowMode || tenant.llmGuardrailsStrict,
                llmKillSwitch: globalKillSwitch,
                llmAllowSensitiveActions: globalAllowSensitive && !(globalShadowMode || tenant.llmGuardrailsStrict),
                verifierRequired,
                minVerifierScore
            }
        };
    }
    async updateTenantLlmSettings(tenantId, input) {
        const updated = await src_2.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                llmAssistEnabled: input.llmAssistEnabled ?? undefined,
                llmConfidenceThreshold: input.llmConfidenceThreshold !== undefined
                    ? Math.max(0.1, Math.min(0.99, Number(input.llmConfidenceThreshold)))
                    : undefined,
                llmGuardrailsStrict: input.llmGuardrailsStrict ?? undefined,
                llmRolloutPercent: input.llmRolloutPercent !== undefined
                    ? Math.max(0, Math.min(100, Number(input.llmRolloutPercent)))
                    : undefined,
                llmModelName: input.llmModelName ? String(input.llmModelName).trim() : undefined
            },
            select: {
                llmAssistEnabled: true,
                llmConfidenceThreshold: true,
                llmGuardrailsStrict: true,
                llmRolloutPercent: true,
                llmModelName: true
            }
        });
        const globalShadowMode = String(process.env.LLM_SHADOW_MODE ?? "true") === "true";
        const globalKillSwitch = String(process.env.LLM_KILL_SWITCH ?? "false") === "true";
        const globalAllowSensitive = String(process.env.LLM_ALLOW_SENSITIVE_ACTIONS ?? "false") === "true";
        const verifierRequired = String(process.env.LLM_VERIFIER_REQUIRED ?? "true") === "true";
        const minVerifierScore = Math.max(0, Math.min(1, Number(process.env.LLM_VERIFIER_MIN_SCORE ?? 0.65)));
        return {
            tenantId,
            settings: {
                llmAssistEnabled: updated.llmAssistEnabled,
                llmConfidenceThreshold: Number(updated.llmConfidenceThreshold),
                llmGuardrailsStrict: updated.llmGuardrailsStrict,
                llmRolloutPercent: updated.llmRolloutPercent,
                llmModelName: updated.llmModelName,
                llmShadowMode: globalShadowMode || updated.llmGuardrailsStrict,
                llmKillSwitch: globalKillSwitch,
                llmAllowSensitiveActions: globalAllowSensitive && !(globalShadowMode || updated.llmGuardrailsStrict),
                verifierRequired,
                minVerifierScore
            }
        };
    }
    async getQualityMetrics(tenantId, range = "7d") {
        const rangeStart = this.resolveRangeStart(range);
        const traces = (await src_2.prisma.llmTrace.findMany({
            where: {
                tenantId,
                traceKind: { in: ["reply", "orchestration"] },
                ...(rangeStart ? { createdAt: { gte: rangeStart } } : {})
            },
            select: {
                latencyMs: true,
                handoffRequired: true,
                response: true
            }
        }));
        const llmTurns = traces.length;
        const verificationTraces = (await src_2.prisma.llmTrace.findMany({
            where: {
                tenantId,
                traceKind: "verification",
                ...(rangeStart ? { createdAt: { gte: rangeStart } } : {})
            },
            select: { response: true }
        }));
        const latencies = traces
            .map((trace) => Number(trace.latencyMs ?? 0))
            .filter((value) => Number.isFinite(value))
            .sort((a, b) => a - b);
        const avgLlmLatencyMs = latencies.length > 0 ? latencies.reduce((acc, value) => acc + value, 0) / latencies.length : 0;
        const p95Index = latencies.length > 0 ? Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95)) : 0;
        const p95LlmLatencyMs = latencies.length > 0 ? latencies[p95Index] : 0;
        const handoffCount = traces.filter((trace) => trace.handoffRequired).length;
        const handoffRate = llmTurns > 0 ? handoffCount / llmTurns : 0;
        const fallbackCount = traces.filter((trace) => {
            const response = trace.response;
            return String(response?.source ?? "") === "fallback";
        }).length;
        const fallbackRate = llmTurns > 0 ? fallbackCount / llmTurns : 0;
        const avgConfidence = llmTurns > 0
            ? traces.reduce((acc, trace) => {
                const response = trace.response;
                return acc + Number(response?.confidence ?? 0);
            }, 0) / llmTurns
            : 0;
        const precisionHits = traces.filter((trace) => {
            const response = trace.response;
            const confidence = Number(response?.confidence ?? 0);
            const qualityFlags = Array.isArray(response?.qualityFlags) ? response?.qualityFlags : [];
            return confidence >= 0.75 && qualityFlags.length === 0 && response?.requiresHuman !== true;
        }).length;
        const decisionPrecisionProxy = llmTurns > 0 ? precisionHits / llmTurns : 0;
        const policyRows = traces.map((trace) => {
            const response = trace.response;
            return response?.policy;
        });
        const actionableRows = policyRows.filter((policy) => policy && String(policy.recommendedAction ?? "") !== "");
        const acceptedRows = actionableRows.filter((policy) => policy &&
            String(policy.executedAction ?? "") !== "shadow_recommendation_only" &&
            String(policy.executedAction ?? "") === String(policy.recommendedAction ?? ""));
        const actionAcceptanceRate = actionableRows.length > 0 ? acceptedRows.length / actionableRows.length : 0;
        const contextRecoveredRows = policyRows.filter((policy) => policy?.contextRecovered === true).length;
        const contextRecoveryRate = llmTurns > 0 ? contextRecoveredRows / llmTurns : 0;
        const handoffQuality = handoffCount > 0
            ? traces.filter((trace) => {
                if (!trace.handoffRequired)
                    return false;
                const response = trace.response;
                return String(response?.policy?.executedAction ?? "") === "handoff_human";
            }).length / handoffCount
            : 0;
        const verifierPassCount = verificationTraces.filter((trace) => {
            const response = trace.response;
            return response?.passed === true && Number(response?.score ?? 0) >= 0.65;
        }).length;
        const verifierPassRate = verificationTraces.length > 0 ? verifierPassCount / verificationTraces.length : 0;
        const preSendBlockCount = traces.filter((trace) => {
            const response = trace.response;
            const hasVerifierBlock = Array.isArray(response?.qualityFlags) && response.qualityFlags.includes("verifier_failed");
            return hasVerifierBlock || String(response?.policy?.executedAction ?? "") === "handoff_human";
        }).length;
        const preSendBlockRate = llmTurns > 0 ? preSendBlockCount / llmTurns : 0;
        const falsePositiveHandoffCount = traces.filter((trace) => {
            if (!trace.handoffRequired)
                return false;
            const response = trace.response;
            const flags = Array.isArray(response?.qualityFlags) ? response.qualityFlags : [];
            return Number(response?.confidence ?? 0) >= 0.8 && flags.length === 0;
        }).length;
        const falsePositiveHandoffRate = handoffCount > 0 ? falsePositiveHandoffCount / handoffCount : 0;
        const fallbackAfterVerifyCount = traces.filter((trace) => {
            const response = trace.response;
            const flags = Array.isArray(response?.qualityFlags) ? response.qualityFlags : [];
            return String(response?.source ?? "") === "fallback" || flags.includes("verifier_failed");
        }).length;
        const fallbackAfterVerifyRate = llmTurns > 0 ? fallbackAfterVerifyCount / llmTurns : 0;
        const feedback = (await src_2.prisma.humanFeedback.findMany({
            where: {
                tenantId,
                ...(rangeStart ? { createdAt: { gte: rangeStart } } : {})
            },
            select: { rating: true, label: true }
        }));
        const negative = feedback.filter((item) => (typeof item.rating === "number" && item.rating <= 2) || item.label === "bad").length;
        const feedbackNegativeRate = feedback.length > 0 ? negative / feedback.length : 0;
        return {
            generatedAt: new Date().toISOString(),
            range,
            quality: {
                llmTurns,
                avgLlmLatencyMs,
                p95LlmLatencyMs,
                handoffRate,
                handoffQuality,
                avgConfidence,
                feedbackNegativeRate,
                decisionPrecisionProxy,
                actionAcceptanceRate,
                fallbackRate,
                contextRecoveryRate,
                verifierPassRate,
                preSendBlockRate,
                falsePositiveHandoffRate,
                fallbackAfterVerifyRate
            }
        };
    }
    async createFeedback(tenantId, appUserId, payload) {
        const targetType = String(payload.targetType ?? "").trim();
        const targetId = String(payload.targetId ?? "").trim();
        if (!targetType || !targetId) {
            throw new common_1.BadRequestException("targetType y targetId son obligatorios");
        }
        const rating = payload.rating === undefined || payload.rating === null
            ? undefined
            : Math.max(1, Math.min(5, Number(payload.rating)));
        const label = payload.label ? String(payload.label).trim().toLowerCase() : undefined;
        const comment = payload.comment ? String(payload.comment).trim() : undefined;
        const inserted = await src_2.prisma.humanFeedback.create({
            data: {
                tenantId,
                targetType,
                targetId,
                rating,
                label,
                comment,
                appUserId: appUserId || undefined
            },
            select: { id: true }
        });
        if (targetType === "llm_trace") {
            try {
                await src_2.prisma.$executeRaw `
          update public.llm_traces
          set response = jsonb_set(
            coalesce(response, '{}'::jsonb),
            '{feedbackRefs}',
            coalesce(response->'feedbackRefs', '[]'::jsonb) || jsonb_build_array(
              jsonb_build_object(
                'feedbackId', ${inserted.id},
                'rating', ${rating ?? null},
                'label', ${label ?? null},
                'comment', ${comment ?? null},
                'createdAt', now()
              )
            )
          )
          where id::text = ${targetId}
            and tenant_id::text = ${tenantId}
        `;
            }
            catch {
                // Es opcional: no bloquea guardar feedback si la actualización de traza falla.
            }
        }
        return { saved: true, id: inserted.id };
    }
    async getPlaybookVariantReport(tenantId, range = "7d") {
        const rangeStart = this.resolveRangeStart(range);
        const rows = rangeStart
            ? (await src_2.prisma.$queryRaw `
          select
            e.intent,
            e.variant,
            count(*)::int as sent,
            sum(case when l.has_stock_reservation = true then 1 else 0 end)::int as reserved,
            sum(case when l.status = 'vendido' then 1 else 0 end)::int as sold
          from public.bot_response_events e
          left join public.leads l on l.id = e.lead_id
          where e.tenant_id::text = ${tenantId}
            and e.created_at >= ${rangeStart}
          group by e.intent, e.variant
          order by e.intent asc, e.variant asc
        `)
            : (await src_2.prisma.$queryRaw `
          select
            e.intent,
            e.variant,
            count(*)::int as sent,
            sum(case when l.has_stock_reservation = true then 1 else 0 end)::int as reserved,
            sum(case when l.status = 'vendido' then 1 else 0 end)::int as sold
          from public.bot_response_events e
          left join public.leads l on l.id = e.lead_id
          where e.tenant_id::text = ${tenantId}
          group by e.intent, e.variant
          order by e.intent asc, e.variant asc
        `);
        return {
            generatedAt: new Date().toISOString(),
            range,
            rows: rows.map((item) => {
                const sent = Number(item.sent ?? 0);
                const reserved = Number(item.reserved ?? 0);
                const sold = Number(item.sold ?? 0);
                return {
                    intent: item.intent,
                    variant: item.variant,
                    sent,
                    reserved,
                    sold,
                    reserveRate: sent > 0 ? reserved / sent : 0,
                    closeRate: sent > 0 ? sold / sent : 0
                };
            })
        };
    }
    async getEvalDatasetSnapshot(tenantId) {
        const items = await src_2.prisma.evalDatasetItem.findMany({
            where: {
                OR: [{ tenantId }, { tenantId: null }],
                isActive: true
            },
            orderBy: [{ updatedAt: "desc" }],
            take: 200,
            select: {
                id: true,
                name: true,
                split: true,
                tags: true,
                isActive: true,
                updatedAt: true
            }
        });
        return {
            generatedAt: new Date().toISOString(),
            total: items.length,
            items: items.map((item) => ({
                id: item.id,
                name: item.name,
                split: String(item.split),
                tags: item.tags,
                isActive: item.isActive,
                updatedAt: item.updatedAt.toISOString()
            }))
        };
    }
    async exportEvalDataset(tenantId, split) {
        const items = await src_2.prisma.evalDatasetItem.findMany({
            where: {
                OR: [{ tenantId }, { tenantId: null }],
                ...(split ? { split: split } : {})
            },
            orderBy: [{ updatedAt: "desc" }],
            take: 2000
        });
        return {
            generatedAt: new Date().toISOString(),
            total: items.length,
            items: items.map((item) => ({
                id: item.id,
                name: item.name,
                slug: item.slug,
                split: String(item.split),
                tags: item.tags,
                input: item.input,
                reference: item.reference,
                isActive: item.isActive,
                updatedAt: item.updatedAt.toISOString()
            }))
        };
    }
    async createEvalDatasetItem(tenantId, payload) {
        const item = await src_2.prisma.evalDatasetItem.create({
            data: {
                tenantId,
                name: String(payload.name ?? "").trim(),
                slug: payload.slug ? String(payload.slug).trim() : undefined,
                split: payload.split ?? "test",
                tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag)) : [],
                input: payload.input ?? {},
                reference: payload.reference ?? {},
                isActive: payload.isActive !== false
            },
            select: { id: true }
        });
        return { saved: true, id: item.id };
    }
    async updateEvalDatasetItem(tenantId, itemId, payload) {
        const existing = await src_2.prisma.evalDatasetItem.findFirst({
            where: { id: itemId, tenantId },
            select: { id: true }
        });
        if (!existing) {
            throw new common_1.BadRequestException("item no encontrado para tenant");
        }
        const item = await src_2.prisma.evalDatasetItem.update({
            where: { id: itemId },
            data: {
                name: payload.name !== undefined ? String(payload.name).trim() : undefined,
                slug: payload.slug !== undefined ? String(payload.slug).trim() : undefined,
                split: payload.split !== undefined ? payload.split : undefined,
                tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag)) : undefined,
                input: payload.input !== undefined ? payload.input : undefined,
                reference: payload.reference !== undefined ? payload.reference : undefined,
                isActive: payload.isActive !== undefined ? payload.isActive : undefined
            },
            select: { id: true }
        });
        return { saved: true, id: item.id };
    }
    async promoteEvalDatasetFromFeedback(tenantId, options) {
        const limit = Math.max(1, Math.min(200, Number(options.limit ?? 30)));
        const labelFilter = options.label ? String(options.label).trim().toLowerCase() : "bad";
        const feedbackRows = await src_2.prisma.humanFeedback.findMany({
            where: {
                tenantId,
                targetType: "llm_trace",
                ...(labelFilter ? { label: labelFilter } : {})
            },
            orderBy: [{ createdAt: "desc" }],
            take: limit
        });
        let inserted = 0;
        for (const feedback of feedbackRows) {
            const trace = await src_2.prisma.llmTrace.findFirst({
                where: { tenantId, id: feedback.targetId },
                select: {
                    id: true,
                    request: true,
                    response: true
                }
            });
            if (!trace)
                continue;
            await src_2.prisma.evalDatasetItem.create({
                data: {
                    tenantId,
                    name: `feedback-${feedback.targetId}`,
                    slug: null,
                    split: options.split ?? "holdout",
                    tags: ["feedback", `label:${feedback.label ?? "na"}`],
                    input: trace.request,
                    reference: {
                        expected: "fallback_or_handoff",
                        feedback: {
                            rating: feedback.rating,
                            label: feedback.label,
                            comment: feedback.comment
                        },
                        llmResponse: trace.response
                    },
                    isActive: true
                }
            });
            inserted += 1;
        }
        return { inserted };
    }
};
exports.OpsService = OpsService;
exports.OpsService = OpsService = __decorate([
    (0, common_1.Injectable)()
], OpsService);
