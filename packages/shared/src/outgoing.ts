import type { LeadStatus } from "./lead";

export type OutgoingPriorityTier = "HIGH" | "MEDIUM" | "LOW";

export const OUTGOING_PRIORITY: Record<OutgoingPriorityTier, number> = {
  HIGH: 1,
  MEDIUM: 5,
  LOW: 10
};

export const SMART_RETRY_DELAYS_MS = [1000, 3000, 10000, 30000] as const;
export const OUTGOING_ATTEMPTS = SMART_RETRY_DELAYS_MS.length + 1;

export const leadStatusToPriorityTier = (status: LeadStatus | string): OutgoingPriorityTier => {
  if (status === "listo_para_cobrar" || status === "vendido") return "HIGH";
  if (status === "caliente" || status === "interesado") return "MEDIUM";
  return "LOW";
};
