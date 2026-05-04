import { randomUUID } from "node:crypto";
import { Job, Worker } from "bullmq";
import { QueueNames, redisConnection } from "../../../packages/queue/src";
import { prisma } from "../../../packages/db/src";
import { EmbeddingService } from "./services/embedding.service";
import {
  Segment,
  Scenario,
  SyntheticConversationService,
  SyntheticTurn,
  Tone
} from "./services/synthetic-conversation.service";

const embeddingService = new EmbeddingService();
const generator = new SyntheticConversationService();

type SyntheticGenJob = {
  tenantId: string;
  segment: Segment;
  scenario?: Scenario;
  tone?: Tone;
};

const MIN_TURN_CHARS = 6;

/** Construye pares (cliente → vendedor) a partir de turnos sintéticos. */
function buildPairs(turns: SyntheticTurn[]): Array<{ incomingText: string; outgoingText: string }> {
  const pairs: Array<{ incomingText: string; outgoingText: string }> = [];
  let pendingIncoming: string | null = null;
  let pendingOutgoing: string[] = [];

  const flush = () => {
    if (pendingIncoming && pendingOutgoing.length > 0) {
      pairs.push({
        incomingText: pendingIncoming.trim(),
        outgoingText: pendingOutgoing.join("\n").trim()
      });
    }
    pendingIncoming = null;
    pendingOutgoing = [];
  };

  for (const t of turns) {
    if (t.speaker === "cliente") {
      if (pendingIncoming && pendingOutgoing.length > 0) flush();
      pendingIncoming = pendingIncoming ? `${pendingIncoming}\n${t.text}` : t.text;
    } else if (t.speaker === "vendedor" && pendingIncoming) {
      pendingOutgoing.push(t.text);
    }
  }
  flush();

  return pairs.filter(
    (p) => p.incomingText.length >= MIN_TURN_CHARS && p.outgoingText.length >= MIN_TURN_CHARS
  );
}

const toVectorLiteral = (vec: number[]): string => `[${vec.join(",")}]`;

export const syntheticGeneratorWorker = new Worker<SyntheticGenJob>(
  QueueNames.syntheticConversationGen,
  async (job: Job<SyntheticGenJob>) => {
    const { tenantId, segment, scenario, tone } = job.data;
    if (!tenantId || !segment) return;
    if (!generator.isAvailable() || !embeddingService.isAvailable()) {
      console.warn("[synthetic-generator] OPENAI_API_KEY no seteada — skip");
      return;
    }

    const startedAt = Date.now();
    console.log(`[synthetic-generator] start tenant=${tenantId} seg=${segment} job=${job.id}`);

    const conv = await generator.generateOne({ segment, scenario, tone });
    if (!conv) {
      console.warn(
        `[synthetic-generator] generate-failed tenant=${tenantId} seg=${segment} job=${job.id} elapsed=${Date.now() - startedAt}ms`
      );
      return;
    }
    console.log(
      `[synthetic-generator] llm-ok tenant=${tenantId} seg=${segment} sc=${conv.scenario} tone=${conv.tone} turns=${conv.turns.length} elapsed=${Date.now() - startedAt}ms`
    );

    const pairs = buildPairs(conv.turns);
    if (pairs.length === 0) {
      console.warn(`[synthetic-generator] no-pairs tenant=${tenantId} job=${job.id}`);
      return;
    }

    const incomings = pairs.map((p) => p.incomingText);
    const embedStart = Date.now();
    const embeddings = await embeddingService.embedMany(incomings);
    console.log(
      `[synthetic-generator] embed-ok tenant=${tenantId} pairs=${pairs.length} elapsed=${Date.now() - embedStart}ms`
    );

    const fakeConvId = randomUUID();
    let inserted = 0;
    for (let i = 0; i < pairs.length; i++) {
      const vec = embeddings[i];
      if (!vec) continue;
      try {
        await (prisma as any).$executeRawUnsafe(
          `INSERT INTO conversation_turn_examples
            (tenant_id, conversation_id, incoming_text, outgoing_text, product_name,
             embedding_model, embedding, source, segment, scenario)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::vector, 'synthetic', $8, $9)`,
          tenantId,
          fakeConvId,
          pairs[i].incomingText,
          pairs[i].outgoingText,
          conv.productName,
          embeddingService.modelName(),
          toVectorLiteral(vec),
          conv.segment,
          conv.scenario
        );
        inserted++;
      } catch (e) {
        console.error("[synthetic-generator] insert failed", e);
      }
    }
    console.log(
      `[synthetic-generator] done tenant=${tenantId} seg=${segment} sc=${conv.scenario} tone=${conv.tone} indexed=${inserted}/${pairs.length} total=${Date.now() - startedAt}ms`
    );
  },
  {
    connection: redisConnection,
    concurrency: Number(process.env.SYNTHETIC_GENERATOR_CONCURRENCY ?? 3)
  }
);
