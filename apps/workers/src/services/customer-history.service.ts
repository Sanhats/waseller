import { prisma } from "../../../../packages/db/src";

export type CustomerHistorySnapshot = {
  recentMessages: Array<{ direction: "incoming" | "outgoing"; message: string; createdAt: string }>;
  pastOrders: Array<{
    externalReference: string;
    status: string;
    totalAmount: string;
    currency: string;
    createdAt: string;
    items: Array<{ productName: string; quantity: number }>;
  }>;
  previousLeadStatuses: Array<{ status: string; product: string | null; updatedAt: string }>;
};

const DEFAULT_RECENT_MESSAGES = 12;
const DEFAULT_PAST_ORDERS = 5;

export class CustomerHistoryService {
  async load(tenantId: string, phone: string): Promise<CustomerHistorySnapshot> {
    const [messages, orders, leads] = await Promise.all([
      prisma.message.findMany({
        where: { tenantId, phone },
        orderBy: { createdAt: "desc" },
        take: DEFAULT_RECENT_MESSAGES,
        select: { direction: true, message: true, createdAt: true }
      }),
      prisma.order.findMany({
        where: { tenantId, buyerPhone: phone },
        orderBy: { createdAt: "desc" },
        take: DEFAULT_PAST_ORDERS,
        select: {
          externalReference: true,
          status: true,
          totalAmount: true,
          currency: true,
          createdAt: true,
          items: { select: { productName: true, quantity: true } }
        }
      }),
      prisma.lead.findMany({
        where: { tenantId, phone },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { status: true, product: true, updatedAt: true }
      })
    ]);

    return {
      recentMessages: messages
        .reverse()
        .map((m: { direction: string; message: string; createdAt: Date }) => ({
          direction: m.direction as "incoming" | "outgoing",
          message: m.message,
          createdAt: m.createdAt.toISOString()
        })),
      pastOrders: orders.map(
        (o: {
          externalReference: string;
          status: unknown;
          totalAmount: { toString(): string };
          currency: string;
          createdAt: Date;
          items: Array<{ productName: string; quantity: number }>;
        }) => ({
          externalReference: o.externalReference,
          status: String(o.status),
          totalAmount: o.totalAmount.toString(),
          currency: o.currency,
          createdAt: o.createdAt.toISOString(),
          items: o.items.map((i: { productName: string; quantity: number }) => ({
            productName: i.productName,
            quantity: i.quantity
          }))
        })
      ),
      previousLeadStatuses: leads.map(
        (l: { status: unknown; product: string | null; updatedAt: Date }) => ({
          status: String(l.status),
          product: l.product,
          updatedAt: l.updatedAt.toISOString()
        })
      )
    };
  }
}
