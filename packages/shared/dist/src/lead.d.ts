export type LeadStatus = "frio" | "consulta" | "interesado" | "caliente" | "listo_para_cobrar" | "vendido";
export interface LeadScoreBreakdown {
    askedPrice: boolean;
    askedStock: boolean;
    purchaseConfirmation: boolean;
}
export declare const computeLeadScore: (input: LeadScoreBreakdown) => number;
export declare const scoreToLeadStatus: (score: number) => LeadStatus;
