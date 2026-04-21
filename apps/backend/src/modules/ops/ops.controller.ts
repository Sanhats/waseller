import { Body, Controller, Get, Param, Post, Put, Req } from "@nestjs/common";
import { Request } from "express";
import { AuthTokenPayload } from "../../../../../packages/shared/src";
import { requireRole } from "../../common/auth/require-role";
import { OpsService } from "./ops.service";

@Controller("ops")
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Get("queues")
  async queues(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    generatedAt: string;
    queues: Array<{
      queue: string;
      counts: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
        paused: number;
      };
    }>;
  }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.getQueuesOverview();
  }

  @Get("funnel")
  async funnel(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    generatedAt: string;
    range: "today" | "7d" | "30d" | "all";
    funnel: {
      contactado: number;
      interesado: number;
      listoParaCobrar: number;
      vendido: number;
      avgFirstResponseSeconds: number;
      reservationRate: number;
      closeRate: number;
    };
  }> {
    requireRole(req.auth?.role, ["admin"]);
    const value = String((req.query as { range?: string }).range ?? "7d").toLowerCase();
    const range = value === "today" || value === "7d" || value === "30d" || value === "all" ? value : "7d";
    return this.opsService.getFunnelMetrics(req.tenantId, range);
  }

  @Get("playbooks")
  async playbooks(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    generatedAt: string;
    playbooks: Array<{
      id: string;
      intent: string;
      variant: string;
      template: string;
      weight: number;
      isActive: boolean;
    }>;
  }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.getPlaybooks(req.tenantId);
  }

  @Get("templates")
  async templates(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    generatedAt: string;
    templates: Array<{
      id: string;
      key: string;
      template: string;
      isActive: boolean;
      updatedAt: string;
    }>;
  }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.getResponseTemplates(req.tenantId);
  }

  @Put("templates")
  async updateTemplates(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Body()
    body: {
      templates: Array<{
        key: string;
        template: string;
        isActive?: boolean;
      }>;
    }
  ): Promise<{ saved: number }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.saveResponseTemplates(req.tenantId, body.templates ?? []);
  }

  @Get("tenant-knowledge")
  async tenantKnowledge(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    tenantId: string;
    tenantName: string;
    persisted: boolean;
    knowledge: Record<string, unknown>;
  }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.getTenantKnowledge(req.tenantId);
  }

  @Get("tenant-knowledge/presets")
  async tenantKnowledgePresets(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    categories: Array<{
      id: string;
      label: string;
      profile: Record<string, unknown>;
    }>;
  }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.getTenantKnowledgePresets();
  }

  @Put("tenant-knowledge")
  async updateTenantKnowledge(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Body()
    body: {
      knowledge?: Record<string, unknown>;
      presetCategory?:
        | "general"
        | "indumentaria_calzado"
        | "electronica"
        | "hogar_deco"
        | "belleza_salud"
        | "repuestos_lubricentro";
    }
  ): Promise<{ tenantId: string; knowledge: Record<string, unknown> }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.updateTenantKnowledge(req.tenantId, body ?? {});
  }

  @Put("playbooks")
  async updatePlaybooks(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Body()
    body: {
      playbooks: Array<{
        intent: string;
        variant: string;
        template: string;
        weight?: number;
        isActive?: boolean;
      }>;
    }
  ): Promise<{ saved: number }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.savePlaybooks(req.tenantId, body.playbooks ?? []);
  }

  @Get("tenant-settings")
  async tenantSettings(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    tenantId: string;
    settings: {
      llmAssistEnabled: boolean;
      llmConfidenceThreshold: number;
      llmGuardrailsStrict: boolean;
      llmRolloutPercent: number;
      llmModelName: string;
      llmShadowMode: boolean;
      llmKillSwitch: boolean;
      llmAllowSensitiveActions: boolean;
      verifierRequired: boolean;
      minVerifierScore: number;
    };
  }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.getTenantLlmSettings(req.tenantId);
  }

  @Put("tenant-settings")
  async updateTenantSettings(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Body()
    body: {
      llmAssistEnabled?: boolean;
      llmConfidenceThreshold?: number;
      llmGuardrailsStrict?: boolean;
      llmRolloutPercent?: number;
      llmModelName?: string;
    }
  ): Promise<{
    tenantId: string;
    settings: {
      llmAssistEnabled: boolean;
      llmConfidenceThreshold: number;
      llmGuardrailsStrict: boolean;
      llmRolloutPercent: number;
      llmModelName: string;
      llmShadowMode: boolean;
      llmKillSwitch: boolean;
      llmAllowSensitiveActions: boolean;
      verifierRequired: boolean;
      minVerifierScore: number;
    };
  }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.updateTenantLlmSettings(req.tenantId, body ?? {});
  }

  @Get("quality")
  async quality(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    generatedAt: string;
    range: "today" | "7d" | "30d" | "all";
    quality: {
      llmTurns: number;
      avgLlmLatencyMs: number;
      p95LlmLatencyMs: number;
      handoffRate: number;
      handoffQuality: number;
      avgConfidence: number;
      feedbackNegativeRate: number;
      decisionPrecisionProxy: number;
      actionAcceptanceRate: number;
      fallbackRate: number;
      contextRecoveryRate: number;
      verifierPassRate: number;
      preSendBlockRate: number;
      falsePositiveHandoffRate: number;
      fallbackAfterVerifyRate: number;
    };
  }> {
    requireRole(req.auth?.role, ["admin"]);
    const value = String((req.query as { range?: string }).range ?? "7d").toLowerCase();
    const range = value === "today" || value === "7d" || value === "30d" || value === "all" ? value : "7d";
    return this.opsService.getQualityMetrics(req.tenantId, range);
  }

  @Get("playbook-report")
  async playbookReport(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    generatedAt: string;
    range: "today" | "7d" | "30d" | "all";
    rows: Array<{
      intent: string;
      variant: string;
      sent: number;
      reserved: number;
      sold: number;
      reserveRate: number;
      closeRate: number;
    }>;
  }> {
    requireRole(req.auth?.role, ["admin"]);
    const value = String((req.query as { range?: string }).range ?? "7d").toLowerCase();
    const range = value === "today" || value === "7d" || value === "30d" || value === "all" ? value : "7d";
    return this.opsService.getPlaybookVariantReport(req.tenantId, range);
  }

  @Post("feedback")
  async submitFeedback(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Body()
    body: {
      targetType: "message" | "llm_trace" | "lead" | "conversation" | "bot_response_event";
      targetId: string;
      rating?: number;
      label?: string;
      comment?: string;
    }
  ): Promise<{ saved: boolean; id: string }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.opsService.createFeedback(req.tenantId, req.auth?.sub, body);
  }

  @Get("eval-dataset")
  async evalDataset(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    generatedAt: string;
    total: number;
    items: Array<{
      id: string;
      name: string;
      split: string;
      tags: string[];
      isActive: boolean;
      updatedAt: string;
    }>;
  }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.getEvalDatasetSnapshot(req.tenantId);
  }

  @Get("eval-dataset/export")
  async evalDatasetExport(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    generatedAt: string;
    total: number;
    items: Array<{
      id: string;
      name: string;
      slug: string | null;
      split: string;
      tags: string[];
      input: unknown;
      reference: unknown;
      isActive: boolean;
      updatedAt: string;
    }>;
  }> {
    requireRole(req.auth?.role, ["admin"]);
    const value = String((req.query as { split?: string }).split ?? "").toLowerCase();
    const split = value === "train" || value === "val" || value === "test" || value === "holdout" ? value : undefined;
    return this.opsService.exportEvalDataset(req.tenantId, split);
  }

  @Post("eval-dataset")
  async createEvalDatasetItem(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Body()
    body: {
      name: string;
      slug?: string;
      split?: "train" | "val" | "test" | "holdout";
      tags?: string[];
      input: unknown;
      reference: unknown;
      isActive?: boolean;
    }
  ): Promise<{ saved: boolean; id: string }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.createEvalDatasetItem(req.tenantId, body);
  }

  @Put("eval-dataset/:itemId")
  async updateEvalDatasetItem(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("itemId") itemId: string,
    @Body()
    body: {
      name?: string;
      slug?: string;
      split?: "train" | "val" | "test" | "holdout";
      tags?: string[];
      input?: unknown;
      reference?: unknown;
      isActive?: boolean;
    }
  ): Promise<{ saved: boolean; id: string }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.updateEvalDatasetItem(req.tenantId, itemId, body);
  }

  @Post("eval-dataset/from-feedback")
  async promoteFromFeedback(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Body()
    body: {
      limit?: number;
      split?: "train" | "val" | "test" | "holdout";
      label?: string;
    }
  ): Promise<{ inserted: number }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.opsService.promoteEvalDatasetFromFeedback(req.tenantId, body ?? {});
  }
}
