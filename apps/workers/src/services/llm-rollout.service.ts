import { createHash } from "node:crypto";
import { prisma } from "../../../../packages/db/src";

const parseList = (value: string | undefined): Set<string> => {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
};

const hashPercent = (value: string): number => {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 8);
  const intValue = Number.parseInt(hex, 16);
  return intValue % 100;
};

export class LlmRolloutService {
  private readonly enabledTenants = parseList(process.env.LLM_ENABLED_TENANTS);
  private readonly disabledTenants = parseList(process.env.LLM_DISABLED_TENANTS);
  private readonly globallyEnabled = String(process.env.LLM_ASSIST_ENABLED ?? "false") === "true";
  private readonly rolloutPercent = Math.max(0, Math.min(100, Number(process.env.LLM_ROLLOUT_PERCENT ?? 0)));
  private readonly shadowModeDefault = String(process.env.LLM_SHADOW_MODE ?? "true") === "true";
  private readonly killSwitch = String(process.env.LLM_KILL_SWITCH ?? "false") === "true";
  private readonly allowSensitiveActions = String(process.env.LLM_ALLOW_SENSITIVE_ACTIONS ?? "false") === "true";
  private readonly verifierRequired = String(process.env.LLM_VERIFIER_REQUIRED ?? "true") === "true";
  private readonly minVerifierScore = Math.max(0, Math.min(1, Number(process.env.LLM_VERIFIER_MIN_SCORE ?? 0.65)));

  async getPolicy(tenantId: string): Promise<{
    enabled: boolean;
    executionMode: "shadow" | "active";
    allowSensitiveActions: boolean;
    verifierRequired: boolean;
    minVerifierScore: number;
  }> {
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

    let tenant:
      | {
          llmAssistEnabled: boolean;
          llmRolloutPercent: number | null;
          llmGuardrailsStrict: boolean;
        }
      | null = null;
    try {
      tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          llmAssistEnabled: true,
          llmRolloutPercent: true,
          llmGuardrailsStrict: true
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Backward-compatible fallback for stale DB schemas missing LLM columns.
      if (
        message.includes("llm_assist_enabled") ||
        message.includes("llm_rollout_percent") ||
        message.includes("llm_guardrails_strict")
      ) {
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

    const effectivePercent =
      typeof tenant.llmRolloutPercent === "number" ? tenant.llmRolloutPercent : this.rolloutPercent;
    const enabled = effectivePercent >= 100 ? true : effectivePercent <= 0 ? false : hashPercent(tenantId) < effectivePercent;
    const executionMode: "shadow" | "active" =
      this.shadowModeDefault || tenant.llmGuardrailsStrict ? "shadow" : "active";
    return {
      enabled,
      executionMode,
      allowSensitiveActions: enabled && executionMode === "active" && this.allowSensitiveActions,
      verifierRequired: this.verifierRequired,
      minVerifierScore: this.minVerifierScore
    };
  }

  async isEnabled(tenantId: string): Promise<boolean> {
    const policy = await this.getPolicy(tenantId);
    return policy.enabled;
  }
}
