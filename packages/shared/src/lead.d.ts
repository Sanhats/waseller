export type LeadStatus = "frio" | "consulta" | "interesado" | "caliente" | "listo_para_cobrar" | "vendido" | "cerrado";
export interface LeadScoreBreakdown {
    askedPrice: boolean;
    askedStock: boolean;
    purchaseConfirmation: boolean;
}
export type LeadStage = "discovery" | "consideration" | "decision" | "handoff";
export declare const computeLeadScore: (input: LeadScoreBreakdown) => number;
export declare const scoreToLeadStatus: (score: number) => LeadStatus;
export declare const leadStageToScore: (stage: LeadStage) => number;
//# sourceMappingURL=lead.d.ts.map