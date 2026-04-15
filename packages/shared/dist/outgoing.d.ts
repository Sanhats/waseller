import type { LeadStatus } from "./lead";
export type OutgoingPriorityTier = "HIGH" | "MEDIUM" | "LOW";
export declare const OUTGOING_PRIORITY: Record<OutgoingPriorityTier, number>;
export declare const SMART_RETRY_DELAYS_MS: readonly [1000, 3000, 10000, 30000];
export declare const OUTGOING_ATTEMPTS: number;
export declare const leadStatusToPriorityTier: (status: LeadStatus | string) => OutgoingPriorityTier;
