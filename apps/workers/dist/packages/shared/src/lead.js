"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadStageToScore = exports.scoreToLeadStatus = exports.computeLeadScore = void 0;
const computeLeadScore = (input) => {
    let score = 0;
    if (input.askedPrice)
        score += 30;
    if (input.askedStock)
        score += 40;
    if (input.purchaseConfirmation)
        score += 100;
    return score;
};
exports.computeLeadScore = computeLeadScore;
const scoreToLeadStatus = (score) => {
    if (score >= 120)
        return "listo_para_cobrar";
    if (score >= 80)
        return "caliente";
    if (score >= 40)
        return "interesado";
    if (score >= 10)
        return "consulta";
    return "frio";
};
exports.scoreToLeadStatus = scoreToLeadStatus;
const leadStageToScore = (stage) => {
    if (stage === "decision")
        return 120;
    if (stage === "consideration")
        return 80;
    return 40;
};
exports.leadStageToScore = leadStageToScore;
