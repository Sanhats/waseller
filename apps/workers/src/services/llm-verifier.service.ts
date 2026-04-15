import { LlmDecisionV1, LlmVerificationResultV1 } from "../../../../packages/queue/src";

type VerificationInput = {
  tenantId: string;
  incomingText: string;
  draftReply: string;
  decision: LlmDecisionV1;
  candidateProducts: Array<{ name: string; price: number; availableStock: number }>;
  tenantProfile?: Record<string, unknown>;
};

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

export class LlmVerifierService {
  private readonly endpoint = process.env.LLM_VERIFIER_URL;
  private readonly model = process.env.LLM_VERIFIER_MODEL ?? process.env.LLM_MODEL_NAME ?? "verifier-default";
  private readonly timeoutMs = Number(process.env.LLM_VERIFIER_TIMEOUT_MS ?? 4000);

  private rulesVerify(input: VerificationInput): LlmVerificationResultV1 {
    const flags: string[] = [];
    const incoming = String(input.incomingText ?? "").trim().toLowerCase();
    const reply = String(input.draftReply ?? "").trim();
    const normalizedReply = reply.toLowerCase();
    if (reply.length < 8) flags.push("reply_too_short");
    if (normalizedReply === incoming) flags.push("echo_reply");
    if (/^(si+|sii+|dale|ok)[\s,.-]*(enviame|mandame|pasame)\b/i.test(reply)) flags.push("role_confusion");
    if (/100%\s*seguro|garantizado/i.test(reply)) flags.push("overpromise");
    const tenantPayment =
      (input.tenantProfile?.payment as { methods?: string[] } | undefined)?.methods ?? [];
    const normalizedPayment = Array.isArray(tenantPayment) ? tenantPayment.map((item) => String(item)) : [];
    if (/link de pago|link\b/i.test(reply) && !normalizedPayment.includes("link_pago")) {
      flags.push("payment_policy_mismatch");
    }
    if (/efectivo/i.test(reply) && !normalizedPayment.includes("efectivo_retiro")) {
      flags.push("payment_policy_mismatch");
    }
    const tenantShipping =
      (input.tenantProfile?.shipping as { methods?: string[] } | undefined)?.methods ?? [];
    const normalizedShipping = Array.isArray(tenantShipping) ? tenantShipping.map((item) => String(item)) : [];
    if (normalizedShipping.length > 0) {
      if (/correo/i.test(reply) && !normalizedShipping.includes("correo")) {
        flags.push("shipping_policy_mismatch");
      }
      if (/moto/i.test(reply) && !normalizedShipping.includes("envio_moto")) {
        flags.push("shipping_policy_mismatch");
      }
    }

    const bestProduct = input.candidateProducts[0];
    if (bestProduct) {
      const expectedPrice = Number(bestProduct.price);
      const mentionsPrice = normalizedReply.match(/\$\s?([\d.,]+)/g) ?? [];
      if (mentionsPrice.length > 0 && Number.isFinite(expectedPrice)) {
        const hasExpected = mentionsPrice.some((candidate) => {
          const numeric = Number(candidate.replace(/[^\d]/g, ""));
          return numeric > 0 && Math.abs(numeric - expectedPrice) <= Math.max(200, expectedPrice * 0.1);
        });
        if (!hasExpected) flags.push("price_mismatch");
      }
    }

    const score = clamp(1 - flags.length * 0.2);
    return {
      passed: flags.length === 0,
      score,
      flags,
      reason: flags.length === 0 ? "rules_passed" : `rules_failed:${flags.join(",")}`,
      provider: "rules",
      model: this.model
    };
  }

  async verify(input: VerificationInput): Promise<LlmVerificationResultV1> {
    const ruleVerdict = this.rulesVerify(input);
    if (!this.endpoint) return ruleVerdict;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          mode: "response_verification",
          input
        }),
        signal: controller.signal
      });
      if (!response.ok) return ruleVerdict;
      const body = (await response.json()) as Partial<LlmVerificationResultV1>;
      return {
        passed: typeof body.passed === "boolean" ? body.passed : ruleVerdict.passed,
        score: clamp(Number(body.score ?? ruleVerdict.score)),
        flags: Array.isArray(body.flags) ? body.flags.map((item) => String(item)) : ruleVerdict.flags,
        reason: String(body.reason ?? ruleVerdict.reason),
        provider: "llm-verifier",
        model: String(body.model ?? this.model)
      };
    } catch {
      return ruleVerdict;
    } finally {
      clearTimeout(timeout);
    }
  }
}
