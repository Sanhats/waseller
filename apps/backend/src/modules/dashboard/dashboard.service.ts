import { Injectable } from "@nestjs/common";
import { prisma } from "../../../../../packages/db/src";
import { LeadsService } from "../leads/leads.service";
import { OnboardingService } from "../onboarding/onboarding.service";

type SummaryLead = {
  id: string;
  phone: string;
  customerName?: string | null;
  status: string;
  leadClosed?: boolean;
  score: number;
  lastMessage?: string | null;
  conversationState?: string;
  conversationStage?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type ConversationRowState = "nuevo" | "activo" | "esperando";

export type DashboardProductHighlight = {
  productId: string;
  name: string;
  imageUrl?: string | null;
  count: number;
};

export type DashboardSummaryResponse = {
  generatedAt: string;
  tenantName: string;
  kpis: {
    leadsToday: number;
    openConversations: number;
    salesClosed7d: number;
    conversionPct: number;
  };
  /** Ventas confirmadas (movimientos `commit`) y reservas de stock (`reserve`) en el período. */
  productHighlights: {
    rangeDays: number;
    rangeLabel: string;
    topSold: DashboardProductHighlight[];
    topReserved: DashboardProductHighlight[];
  };
  conversationList: Array<{
    id: string;
    phone: string;
    displayName: string;
    lastMessage: string;
    timeLabel: string;
    state: ConversationRowState;
  }>;
};

function toIsoString(value: string | Date | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  return value.toISOString();
}

function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t);
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatRelativeShort(iso: string | undefined): string {
  const d = parseDate(iso);
  if (!d) return "recién";
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 45) return "hace un momento";
  if (sec < 3600) return `hace ${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `hace ${Math.floor(sec / 3600)} h`;
  if (sec < 172800) return "ayer";
  return `hace ${Math.floor(sec / 86400)} días`;
}

function leadDisplayName(lead: SummaryLead): string {
  return String(lead.customerName ?? "").trim() || lead.phone;
}

function asLeads(raw: unknown[]): SummaryLead[] {
  return raw.map((row) => row as SummaryLead);
}

const PRODUCT_HIGHLIGHT_RANGE_DAYS = 30;

async function loadProductHighlights(
  tenantId: string,
  since: Date,
): Promise<{ topSold: DashboardProductHighlight[]; topReserved: DashboardProductHighlight[] }> {
  const soldRows = (await prisma.$queryRaw`
    select
      m.product_id::text as "productId",
      p.name as "name",
      p.image_url as "imageUrl",
      count(*)::int as "count"
    from public.stock_movements m
    inner join public.products p on p.id = m.product_id
    where m.tenant_id::text = ${tenantId}
      and m.movement_type::text = 'commit'
      and m.product_id is not null
      and m.created_at >= ${since}
    group by m.product_id, p.name, p.image_url
    order by count(*) desc
    limit 6
  `) as Array<{ productId: string; name: string; imageUrl?: string | null; count: number }>;

  const reservedRows = (await prisma.$queryRaw`
    select
      m.product_id::text as "productId",
      p.name as "name",
      p.image_url as "imageUrl",
      count(*)::int as "count"
    from public.stock_movements m
    inner join public.products p on p.id = m.product_id
    where m.tenant_id::text = ${tenantId}
      and m.movement_type::text = 'reserve'
      and m.product_id is not null
      and m.created_at >= ${since}
    group by m.product_id, p.name, p.image_url
    order by count(*) desc
    limit 6
  `) as Array<{ productId: string; name: string; imageUrl?: string | null; count: number }>;

  return {
    topSold: soldRows.map((r) => ({
      productId: r.productId,
      name: String(r.name ?? ""),
      imageUrl: r.imageUrl,
      count: Number(r.count ?? 0),
    })),
    topReserved: reservedRows.map((r) => ({
      productId: r.productId,
      name: String(r.name ?? ""),
      imageUrl: r.imageUrl,
      count: Number(r.count ?? 0),
    })),
  };
}

function rowState(lead: SummaryLead): ConversationRowState {
  if (lead.conversationState === "manual_paused") return "esperando";
  if (lead.status === "listo_para_cobrar") return "esperando";
  const st = lead.conversationStage ?? "";
  if (
    ["payment_link_sent", "waiting_payment_confirmation", "reserved_waiting_payment_method"].includes(st)
  ) {
    return "esperando";
  }
  if (lead.status === "frio") return "nuevo";
  return "activo";
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly onboardingService: OnboardingService,
  ) {}

  async getSummary(tenantId: string): Promise<DashboardSummaryResponse> {
    const now = new Date();
    const highlightsSince = new Date(now.getTime() - PRODUCT_HIGHLIGHT_RANGE_DAYS * 86400000);

    const [rawLeads, onboarding, productHighlights] = await Promise.all([
      this.leadsService.listByTenant(tenantId, true, false, false),
      this.onboardingService.getStatus(tenantId),
      loadProductHighlights(tenantId, highlightsSince).catch(() => ({
        topSold: [] as DashboardProductHighlight[],
        topReserved: [] as DashboardProductHighlight[],
      })),
    ]);

    const leads = asLeads(rawLeads as unknown[]);
    const tenantName = onboarding.tenantName?.trim() || "tu negocio";
    const sod = startOfLocalDay(now);
    const weekAgo = new Date(now.getTime() - 7 * 86400000);

    const activeLeads = leads.filter((l) => !l.leadClosed && l.status !== "cerrado");

    const leadsToday = activeLeads.filter((l) => {
      const c = parseDate(toIsoString(l.createdAt));
      return c && c >= sod;
    }).length;

    const openConversations = activeLeads.filter(
      (l) => (l.conversationState ?? "open") !== "lead_closed",
    ).length;

    const salesClosed7d = leads.filter((l) => {
      if (l.status !== "vendido") return false;
      const u = parseDate(toIsoString(l.updatedAt));
      return u && u >= weekAgo;
    }).length;

    const soldAll = leads.filter((l) => l.status === "vendido").length;
    const pipeline = activeLeads.filter((l) => l.status !== "vendido").length;
    const conversionPct =
      soldAll + pipeline > 0 ? Math.round((100 * soldAll) / Math.max(1, soldAll + pipeline)) : 0;

    const conversationList = activeLeads
      .filter((l) => (l.conversationState ?? "open") !== "lead_closed")
      .sort(
        (a, b) =>
          (parseDate(toIsoString(b.updatedAt))?.getTime() ?? 0) -
          (parseDate(toIsoString(a.updatedAt))?.getTime() ?? 0),
      )
      .slice(0, 22)
      .map((l) => ({
        id: l.id,
        phone: l.phone,
        displayName: leadDisplayName(l),
        lastMessage: String(l.lastMessage ?? "").slice(0, 80).trim() || "Sin mensajes recientes",
        timeLabel: formatRelativeShort(toIsoString(l.updatedAt)),
        state: rowState(l),
      }));

    return {
      generatedAt: now.toISOString(),
      tenantName,
      kpis: {
        leadsToday,
        openConversations,
        salesClosed7d,
        conversionPct,
      },
      productHighlights: {
        rangeDays: PRODUCT_HIGHLIGHT_RANGE_DAYS,
        rangeLabel: `últimos ${PRODUCT_HIGHLIGHT_RANGE_DAYS} días`,
        topSold: productHighlights.topSold,
        topReserved: productHighlights.topReserved,
      },
      conversationList,
    };
  }
}
