import { prisma } from "../../../../packages/db/src";

export type ConversationTurnSnippet = {
  direction: "incoming" | "outgoing";
  message: string;
};

export const normalizeSnippet = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

/** Turno mínimo para waseller-crew (misma forma que `ShadowCompareRecentMessageV1`). */
export type CrewRecentTurn = {
  direction: "incoming" | "outgoing";
  message: string;
};

/**
 * Garantiza que, si el último turno es un incoming, el hilo incluya el **último outgoing real**
 * persistido en `messages` (no solo `bot_response_events`). Así cada POST shadow-compare puede
 * detectar eco / duplicado respecto del texto que el cliente ya recibió por WhatsApp.
 */
export async function injectLastOutgoingMessageForCrew(
  tenantId: string,
  phone: string,
  chronological: CrewRecentTurn[]
): Promise<CrewRecentTurn[]> {
  const phoneTrim = String(phone ?? "").trim();
  if (!tenantId || !phoneTrim) return chronological;

  const chrono = chronological.filter((m) => String(m?.message ?? "").trim());
  if (chrono.length === 0) return chronological;

  let lastOutgoingText = "";
  try {
    const row = await prisma.message.findFirst({
      where: { tenantId, phone: phoneTrim, direction: "outgoing" },
      orderBy: { createdAt: "desc" },
      select: { message: true }
    });
    lastOutgoingText = String(row?.message ?? "").trim();
  } catch {
    return chronological;
  }
  if (!lastOutgoingText) return chronological;

  const last = chrono[chrono.length - 1];
  if (last.direction !== "incoming") return chrono;

  const before = chrono.slice(0, -1);
  const outgoingNorm = normalizeSnippet(lastOutgoingText);
  const alreadyPresent = before.some(
    (m) => m.direction === "outgoing" && normalizeSnippet(m.message) === outgoingNorm
  );
  if (alreadyPresent) return chrono;

  const trimmed = [...before, { direction: "outgoing" as const, message: lastOutgoingText }, last].slice(-8);
  return trimmed;
}

/**
 * El `Message` saliente se persiste en `sender.worker` después del envío; el orquestador
 * puede correr antes y ver solo entradas seguidas. Completamos con el último texto bot
 * registrado en `bot_response_events` (misma fuente que analytics del lead worker).
 */
export async function enrichRecentMessagesWithLastBotReply(
  tenantId: string,
  phone: string,
  recentDesc: ConversationTurnSnippet[]
): Promise<ConversationTurnSnippet[]> {
  if (recentDesc.length === 0) return recentDesc;
  const chrono = recentDesc.slice().reverse();
  const last = chrono[chrono.length - 1];
  if (last.direction !== "incoming") return recentDesc;
  const prev = chrono.length >= 2 ? chrono[chrono.length - 2] : null;
  if (prev?.direction === "outgoing") return recentDesc;

  try {
    const rows = await prisma.botResponseEvent.findMany({
      where: { tenantId, phone },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { message: true }
    });
    const botMsg = String(rows[0]?.message ?? "").trim();
    if (!botMsg) return recentDesc;

    const outgoingNorms = new Set(
      chrono.filter((m) => m.direction === "outgoing").map((m) => normalizeSnippet(m.message))
    );
    if (outgoingNorms.has(normalizeSnippet(botMsg))) return recentDesc;

    const injected: ConversationTurnSnippet = { direction: "outgoing", message: botMsg };
    const mergedChrono = [...chrono.slice(0, -1), injected, last];
    const trimmed = mergedChrono.slice(-8);
    return trimmed.slice().reverse();
  } catch {
    return recentDesc;
  }
}

export function replySimilarity(a: string, b: string): number {
  const na = normalizeSnippet(a);
  const nb = normalizeSnippet(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  if (short.length >= 24 && long.includes(short.slice(0, Math.min(48, short.length)))) return 0.92;
  const wa = new Set(short.split(/\s+/).filter((w) => w.length > 3));
  if (wa.size === 0) return 0;
  let hit = 0;
  for (const w of wa) {
    if (nb.includes(w)) hit += 1;
  }
  return hit / wa.size;
}
