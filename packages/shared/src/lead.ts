export type LeadStatus =
  | "frio"
  | "consulta"
  | "interesado"
  | "caliente"
  | "listo_para_cobrar"
  | "vendido"
  | "cerrado";

export interface LeadScoreBreakdown {
  askedPrice: boolean;
  askedStock: boolean;
  purchaseConfirmation: boolean;
}

export type LeadStage = "discovery" | "consideration" | "decision" | "handoff";

export const computeLeadScore = (input: LeadScoreBreakdown): number => {
  let score = 0;
  if (input.askedPrice) score += 30;
  if (input.askedStock) score += 40;
  if (input.purchaseConfirmation) score += 100;
  return score;
};

export const scoreToLeadStatus = (score: number): LeadStatus => {
  if (score >= 120) return "listo_para_cobrar";
  if (score >= 80) return "caliente";
  if (score >= 40) return "interesado";
  if (score >= 10) return "consulta";
  return "frio";
};

export const leadStageToScore = (stage: LeadStage): number => {
  if (stage === "decision") return 120;
  if (stage === "consideration") return 80;
  return 40;
};
