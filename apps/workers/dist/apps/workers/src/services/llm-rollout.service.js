"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmRolloutService = void 0;
const node_crypto_1 = require("node:crypto");
const src_1 = require("../../../../packages/db/src");
const parseList = (value) => {
    return new Set(String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean));
};
const hashPercent = (value) => {
    const hex = (0, node_crypto_1.createHash)("sha256").update(value).digest("hex").slice(0, 8);
    const intValue = Number.parseInt(hex, 16);
    return intValue % 100;
};
class LlmRolloutService {
    enabledTenants = parseList(process.env.LLM_ENABLED_TENANTS);
    disabledTenants = parseList(process.env.LLM_DISABLED_TENANTS);
    globallyEnabled = String(process.env.LLM_ASSIST_ENABLED ?? "false") === "true";
    rolloutPercent = Math.max(0, Math.min(100, Number(process.env.LLM_ROLLOUT_PERCENT ?? 0)));
    shadowModeDefault = String(process.env.LLM_SHADOW_MODE ?? "true") === "true";
    killSwitch = String(process.env.LLM_KILL_SWITCH ?? "false") === "true";
    allowSensitiveActions = String(process.env.LLM_ALLOW_SENSITIVE_ACTIONS ?? "false") === "true";
    verifierRequired = String(process.env.LLM_VERIFIER_REQUIRED ?? "true") === "true";
    minVerifierScore = Math.max(0, Math.min(1, Number(process.env.LLM_VERIFIER_MIN_SCORE ?? 0.65)));
    async getPolicy(tenantId) {
        if (this.killSwitch) {
            return {
                enabled: false,
                executionMode: "shadow",
                allowSensitiveActions: false,
                verifierRequired: this.verifierRequired,
                minVerifierScore: this.minVerifierScore
            };
        }
        if (this.disabledTenants.has(tenantId)) {
            return {
                enabled: false,
                executionMode: "shadow",
                allowSensitiveActions: false,
                verifierRequired: this.verifierRequired,
                minVerifierScore: this.minVerifierScore
            };
        }
        if (this.enabledTenants.has(tenantId)) {
            return {
                enabled: true,
                executionMode: this.shadowModeDefault ? "shadow" : "active",
                allowSensitiveActions: this.allowSensitiveActions && !this.shadowModeDefault,
                verifierRequired: this.verifierRequired,
                minVerifierScore: this.minVerifierScore
            };
        }
        let tenant = null;
        try {
            tenant = await src_1.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: {
                    llmAssistEnabled: true,
                    llmRolloutPercent: true,
                    llmGuardrailsStrict: true
                }
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // Backward-compatible fallback for stale DB schemas missing LLM columns.
            if (message.includes("llm_assist_enabled") ||
                message.includes("llm_rollout_percent") ||
                message.includes("llm_guardrails_strict")) {
                return {
                    enabled: this.globallyEnabled,
                    executionMode: this.shadowModeDefault ? "shadow" : "active",
                    allowSensitiveActions: this.globallyEnabled && !this.shadowModeDefault && this.allowSensitiveActions,
                    verifierRequired: this.verifierRequired,
                    minVerifierScore: this.minVerifierScore
                };
            }
            throw error;
        }
        if (!tenant) {
            return {
                enabled: false,
                executionMode: "shadow",
                allowSensitiveActions: false,
                verifierRequired: this.verifierRequired,
                minVerifierScore: this.minVerifierScore
            };
        }
        if (!tenant.llmAssistEnabled && !this.globallyEnabled) {
            return {
                enabled: false,
                executionMode: "shadow",
                allowSensitiveActions: false,
                verifierRequired: this.verifierRequired,
                minVerifierScore: this.minVerifierScore
            };
        }
        const effectivePercent = typeof tenant.llmRolloutPercent === "number" ? tenant.llmRolloutPercent : this.rolloutPercent;
        const enabled = effectivePercent >= 100 ? true : effectivePercent <= 0 ? false : hashPercent(tenantId) < effectivePercent;
        const executionMode = this.shadowModeDefault || tenant.llmGuardrailsStrict ? "shadow" : "active";
        return {
            enabled,
            executionMode,
            allowSensitiveActions: enabled && executionMode === "active" && this.allowSensitiveActions,
            verifierRequired: this.verifierRequired,
            minVerifierScore: this.minVerifierScore
        };
    }
    async isEnabled(tenantId) {
        const policy = await this.getPolicy(tenantId);
        return policy.enabled;
    }
}
exports.LlmRolloutService = LlmRolloutService;
