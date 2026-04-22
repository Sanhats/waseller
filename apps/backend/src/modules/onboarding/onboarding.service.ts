import { BadGatewayException, BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { prisma } from "../../../../../packages/db/src";
import { getWhatsappServiceBaseUrl, isTenantCrewCommercialContextComplete } from "@waseller/shared";
import { MercadoPagoService } from "../mercado-pago/mercado-pago.service";
import { OpsService } from "../ops/ops.service";

type OnboardingStepKey = "connect_whatsapp" | "connect_mercadopago" | "configure_business" | "create_catalog";

type OnboardingStep = {
  key: OnboardingStepKey;
  title: string;
  description: string;
  completed: boolean;
  href: string;
  metric: string;
};

type SessionSnapshot = {
  key: string;
  tenantId: string;
  whatsappNumber: string;
  status: "connecting" | "connected" | "disconnected" | "qr_required";
  retries: number;
  lastConnectedAt?: string;
  lastError?: string;
  qr?: string;
};

type WhatsappConnectionState = {
  tenantWhatsappNumber: string | null;
  sessionStatus: "connecting" | "connected" | "disconnected" | "qr_required" | "not_connected";
  qrAvailable: boolean;
  lastConnectedAt?: string;
  retries?: number;
  lastError?: string;
};

type MercadoPagoConnectionState = {
  provider: "mercadopago";
  configured: boolean;
  status: "disconnected" | "connected" | "expired" | "error";
  accountId: string | null;
  accountLabel: string | null;
  publicKey: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
};

@Injectable()
export class OnboardingService {
  constructor(
    private readonly mercadoPagoService: MercadoPagoService,
    private readonly opsService: OpsService
  ) {}

  private whatsappServiceUrl = getWhatsappServiceBaseUrl() ?? "";

  private normalizeWhatsappNumber(value: string | null | undefined): string | null {
    const normalized = String(value ?? "").trim().replace(/[^\d]/g, "");
    return /^\d{8,18}$/.test(normalized) ? normalized : null;
  }

  private async listSessions(): Promise<SessionSnapshot[]> {
    if (!this.whatsappServiceUrl) return [];
    try {
      const response = await fetch(`${this.whatsappServiceUrl}/sessions`, { cache: "no-store" });
      if (!response.ok) return [];
      return (await response.json()) as SessionSnapshot[];
    } catch {
      return [];
    }
  }

  private async getTenantWhatsappNumber(tenantId: string): Promise<string | null> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { whatsappNumber: true }
    });
    return tenant?.whatsappNumber ?? null;
  }

  async getWhatsappState(tenantId: string): Promise<WhatsappConnectionState> {
    const [tenantWhatsappNumber, sessions] = await Promise.all([
      this.getTenantWhatsappNumber(tenantId),
      this.listSessions()
    ]);
    const tenantSessions = sessions.filter((item) => item.tenantId === tenantId);
    const active =
      tenantSessions.find((item) => item.status === "connected") ??
      tenantSessions.find((item) => item.status === "qr_required") ??
      tenantSessions.find((item) => item.status === "connecting") ??
      tenantSessions[0];

    if (!active) {
      return {
        tenantWhatsappNumber,
        sessionStatus: "not_connected",
        qrAvailable: false
      };
    }

    return {
      tenantWhatsappNumber: active.whatsappNumber ?? tenantWhatsappNumber,
      sessionStatus: active.status,
      qrAvailable: active.status === "qr_required",
      lastConnectedAt: active.lastConnectedAt,
      retries: active.retries,
      lastError: active.lastError
    };
  }

  async connectWhatsapp(tenantId: string, inputWhatsappNumber?: string): Promise<WhatsappConnectionState> {
    const tenantWhatsappNumberStored = await this.getTenantWhatsappNumber(tenantId);
    const tenantWhatsappNumber =
      this.normalizeWhatsappNumber(tenantWhatsappNumberStored) ?? this.normalizeWhatsappNumber(inputWhatsappNumber);
    if (!tenantWhatsappNumber) {
      throw new BadRequestException(
        "Falta configurar el número de WhatsApp del tenant. Cargalo en onboarding para continuar."
      );
    }

    if (!tenantWhatsappNumberStored) {
      const whatsappTaken = await prisma.tenant.findFirst({
        where: { whatsappNumber: tenantWhatsappNumber, NOT: { id: tenantId } },
        select: { id: true }
      });
      if (whatsappTaken) {
        throw new ConflictException(
          "Ese número de WhatsApp ya está registrado en otra cuenta. No se puede reutilizar el mismo número para dos negocios."
        );
      }
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { whatsappNumber: tenantWhatsappNumber }
      });
    }

    if (!this.whatsappServiceUrl) {
      throw new BadGatewayException(
        "Falta WHATSAPP_SERVICE_URL (o WHATSAPP_API_URL): la URL pública del servicio WhatsApp. Configurala en el entorno del API."
      );
    }

    let response: Response;
    try {
      response = await fetch(`${this.whatsappServiceUrl}/sessions/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          whatsappNumber: tenantWhatsappNumber
        })
      });
    } catch {
      throw new BadGatewayException("No se pudo conectar con el servicio de WhatsApp.");
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new BadGatewayException(
        detail?.trim() || "El servicio de WhatsApp devolvió un error al intentar conectar."
      );
    }

    return this.getWhatsappState(tenantId);
  }

  async disconnectWhatsapp(tenantId: string): Promise<WhatsappConnectionState> {
    const tenantWhatsappNumber =
      this.normalizeWhatsappNumber(await this.getTenantWhatsappNumber(tenantId)) ?? null;
    if (!tenantWhatsappNumber) {
      throw new BadRequestException("No hay número de WhatsApp configurado para este negocio.");
    }

    if (!this.whatsappServiceUrl) {
      throw new BadGatewayException(
        "Falta WHATSAPP_SERVICE_URL (o WHATSAPP_API_URL): la URL del servicio WhatsApp no está configurada."
      );
    }

    try {
      const response = await fetch(`${this.whatsappServiceUrl}/sessions/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          whatsappNumber: tenantWhatsappNumber,
          logout: false
        })
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new BadGatewayException(
          detail?.trim() || "El servicio de WhatsApp devolvió un error al desconectar."
        );
      }
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof BadRequestException) throw error;
      throw new BadGatewayException("No se pudo contactar al servicio de WhatsApp para desconectar.");
    }

    return this.getWhatsappState(tenantId);
  }

  async getWhatsappQrPng(tenantId: string): Promise<Buffer | null> {
    const state = await this.getWhatsappState(tenantId);
    if (!state.tenantWhatsappNumber) return null;
    if (!state.qrAvailable && state.sessionStatus !== "qr_required") return null;

    if (!this.whatsappServiceUrl) return null;

    const params = new URLSearchParams({
      tenantId,
      whatsappNumber: state.tenantWhatsappNumber
    });
    const response = await fetch(`${this.whatsappServiceUrl}/sessions/qr.png?${params.toString()}`, {
      cache: "no-store"
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
  }

  async getStatus(tenantId: string): Promise<{
    generatedAt: string;
    tenantName: string;
    allCompleted: boolean;
    completionPercent: number;
    /** Hay fila en `tenant_knowledge` (puede faltar tono/entregas para el crew). */
    tenantKnowledgePersisted: boolean;
    /** Perfil listo para `tenantBrief` del crew (tono + entregas). */
    crewCommercialContextComplete: boolean;
    steps: OnboardingStep[];
    whatsapp: WhatsappConnectionState;
    mercadoPago: MercadoPagoConnectionState;
  }> {
    const [productsCount, whatsapp, mercadoPago, tenantKnowledge] = await Promise.all([
      prisma.product.count({ where: { tenantId } }),
      this.getWhatsappState(tenantId),
      this.mercadoPagoService.getStatus(tenantId),
      this.opsService.getTenantKnowledge(tenantId)
    ]);
    const tenantName = tenantKnowledge.tenantName;
    const whatsappConnected = whatsapp.sessionStatus === "connected";
    const mercadoPagoConnected = mercadoPago.status === "connected";
    const tenantKnowledgePersisted = tenantKnowledge.persisted;
    const crewCommercialContextComplete = isTenantCrewCommercialContextComplete(tenantKnowledge.knowledge);
    const businessProfileSaved = tenantKnowledgePersisted && crewCommercialContextComplete;
    const catalogReady = productsCount >= 3;
    const businessStepMetric = !tenantKnowledgePersisted
      ? "Pendiente"
      : !crewCommercialContextComplete
        ? "Incompleto: tono y entregas"
        : "Guardado";

    const steps: OnboardingStep[] = [
      {
        key: "connect_whatsapp",
        title: "Vincular WhatsApp",
        description: "Conectá la sesión del negocio para recibir y enviar mensajes.",
        completed: whatsappConnected,
        href: "/",
        metric: whatsappConnected ? "Listo" : "Pendiente"
      },
      {
        key: "connect_mercadopago",
        title: "Conectar Mercado Pago",
        description: "Vinculá la cuenta para generar links de pago por conversación.",
        completed: mercadoPagoConnected,
        href: "/",
        metric: mercadoPagoConnected ? "Listo" : "Pendiente"
      },
      {
        key: "configure_business",
        title: "Contexto de la tienda",
        description:
          "Rubro, pagos, variantes y datos para el asistente (tono + entregas): se envían a waseller-crew como contexto comercial.",
        completed: businessProfileSaved,
        href: "/",
        metric: businessStepMetric
      },
      {
        key: "create_catalog",
        title: "Cargar productos",
        description: "Creá al menos 3 productos en el catálogo para operar ventas.",
        completed: catalogReady,
        href: "/stock",
        metric: `${productsCount}/3 productos`
      }
    ];

    const completedCount = steps.filter((step) => step.completed).length;
    const completionPercent = Math.round((completedCount / steps.length) * 100);
    const allCompleted = steps.every((step) => step.completed);

    return {
      generatedAt: new Date().toISOString(),
      tenantName,
      allCompleted,
      completionPercent,
      tenantKnowledgePersisted,
      crewCommercialContextComplete,
      steps,
      whatsapp,
      mercadoPago
    };
  }
}
