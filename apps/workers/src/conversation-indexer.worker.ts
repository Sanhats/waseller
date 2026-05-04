import { Job, Worker } from "bullmq";
import { QueueNames, redisConnection } from "../../../packages/queue/src";
import { prisma } from "../../../packages/db/src";
import { EmbeddingService } from "./services/embedding.service";

const embeddingService = new EmbeddingService();

type ConversationIndexingJob = {
  tenantId: string;
  conversationId: string;
};

type Turn = {
  incomingText: string;
  outgoingText: string;
  productName?: string | null;
  intentHint?: string | null;
  leadStage?: string | null;
};

const MIN_TURN_CHARS = 10;
const MAX_TURNS_PER_CONVERSATION = 30;

/** Construye pares (incoming → próximo outgoing del vendedor). Concatena outgoings consecutivos. */
function buildTurns(
  messages: Array<{ direction: string; message: string }>
): Turn[] {
  const turns: Turn[] = [];
  let pendingIncoming: string | null = null;
  let pendingOutgoing: string[] = [];

  const flush = () => {
    if (pendingIncoming && pendingOutgoing.length > 0) {
      turns.push({
        incomingText: pendingIncoming.trim(),
        outgoingText: pendingOutgoing.join("\n").trim()
      });
    }
    pendingIncoming = null;
    pendingOutgoing = [];
  };

  for (const m of messages) {
    const text = (m.message ?? "").trim();
    if (!text) continue;
    if (m.direction === "incoming") {
      // Si ya teníamos un par armado y aparece un nuevo incoming, cerramos el anterior.
      if (pendingIncoming && pendingOutgoing.length > 0) {
        flush();
      }
      pendingIncoming = pendingIncoming ? `${pendingIncoming}\n${text}` : text;
    } else if (m.direction === "outgoing") {
      if (pendingIncoming) {
        pendingOutgoing.push(text);
      }
    }
  }
  flush();

  return turns
    .filter(
      (t) =>
        t.incomingText.length >= MIN_TURN_CHARS && t.outgoingText.length >= MIN_TURN_CHARS
    )
    .slice(-MAX_TURNS_PER_CONVERSATION);
}

const toVectorLiteral = (vec: number[]): string => `[${vec.join(",")}]`;

export const conversationIndexerWorker = new Worker<ConversationIndexingJob>(
  QueueNames.conversationIndexing,
  async (job: Job<ConversationIndexingJob>) => {
    const { tenantId, conversationId } = job.data;
    if (!tenantId || !conversationId) return;
    if (!embeddingService.isAvailable()) {
      console.warn("[conversation-indexer] OPENAI_API_KEY no seteada — skip");
      return;
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { id: true, phone: true, leadId: true }
    });
    if (!conversation) return;

    const messages = await prisma.message.findMany({
      where: { tenantId, phone: conversation.phone },
      orderBy: { createdAt: "asc" },
      select: { direction: true, message: true }
    });

    const turns = buildTurns(messages);
    if (turns.length === 0) return;

    // Contexto: producto del lead (si existe) — útil para filtrar matches en retrieval.
    let productName: string | null = null;
    if (conversation.leadId) {
      const lead = await prisma.lead.findUnique({
        where: { id: conversation.leadId },
        select: { product: true, status: true }
      });
      productName = lead?.product ?? null;
    }

    // Embeber todos los incomings de una vez (más barato).
    const incomings = turns.map((t) => t.incomingText);
    const embeddings = await embeddingService.embedMany(incomings);

    // Reemplazo idempotente: borramos los turnos previos de esta conversación.
    await (prisma as any).$executeRawUnsafe(
      `DELETE FROM conversation_turn_examples WHERE conversation_id = $1::uuid AND tenant_id = $2::uuid`,
      conversationId,
      tenantId
    );

    let inserted = 0;
    for (let i = 0; i < turns.length; i++) {
      const vec = embeddings[i];
      if (!vec) continue;
      try {
        await (prisma as any).$executeRawUnsafe(
          `INSERT INTO conversation_turn_examples
            (tenant_id, conversation_id, incoming_text, outgoing_text, product_name, embedding_model, embedding)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::vector)`,
          tenantId,
          conversationId,
          turns[i].incomingText,
          turns[i].outgoingText,
          productName,
          embeddingService.modelName(),
          toVectorLiteral(vec)
        );
        inserted++;
      } catch (e) {
        console.error("[conversation-indexer] insert failed", e);
      }
    }

    console.log(`[conversation-indexer] tenant=${tenantId} conv=${conversationId} indexed=${inserted}/${turns.length}`);
  },
  {
    connection: redisConnection,
    concurrency: Number(process.env.CONVERSATION_INDEXER_CONCURRENCY ?? 2)
  }
);
