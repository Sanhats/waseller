import { prisma } from "../../../../packages/db/src";
import { EmbeddingService } from "./embedding.service";

export type RagExample = {
  incomingText: string;
  outgoingText: string;
  productName: string | null;
  similarity: number;
  source: "real" | "imported" | "synthetic";
};

const SOURCE_BOOST: Record<RagExample["source"], number> = {
  real: 0.05,
  imported: 0.02,
  synthetic: 0
};

const TOP_K_DEFAULT = Number(process.env.RAG_TOP_K ?? 3);
const MIN_SIMILARITY = Number(process.env.RAG_MIN_SIMILARITY ?? 0.75);

export class RagRetrievalService {
  constructor(private readonly embeddingService: EmbeddingService) {}

  /**
   * Devuelve los K turnos más similares al `incomingText` para este tenant.
   * Si pasamos `productName`, prioriza matches del mismo producto (fallback a global).
   * Devuelve [] si: no hay API key, no hay turnos indexados, o ninguno supera el threshold.
   */
  async retrieve(
    tenantId: string,
    incomingText: string,
    productName?: string | null,
    k: number = TOP_K_DEFAULT
  ): Promise<RagExample[]> {
    if (!this.embeddingService.isAvailable()) return [];
    if (!incomingText || incomingText.trim().length < 6) return [];

    const queryVec = await this.embeddingService.embed(incomingText);
    if (!queryVec) return [];
    const literal = `[${queryVec.join(",")}]`;

    // Cosine similarity = 1 - cosine_distance. pgvector usa `<=>` para distancia coseno.
    const rows = (await (prisma as any).$queryRawUnsafe(
      `SELECT incoming_text, outgoing_text, product_name, source,
              1 - (embedding <=> $1::vector) AS similarity
       FROM conversation_turn_examples
       WHERE tenant_id = $2::uuid
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      literal,
      tenantId,
      Math.max(1, k * 4)
    )) as Array<{
      incoming_text: string;
      outgoing_text: string;
      product_name: string | null;
      source: string;
      similarity: number;
    }>;

    const normSource = (s: string): RagExample["source"] => {
      if (s === "imported") return "imported";
      if (s === "synthetic") return "synthetic";
      return "real";
    };

    let candidates = rows
      .filter((r) => Number(r.similarity) >= MIN_SIMILARITY)
      .map((r) => {
        const src = normSource(r.source);
        return {
          incomingText: r.incoming_text,
          outgoingText: r.outgoing_text,
          productName: r.product_name,
          similarity: Number(r.similarity),
          source: src,
          /** Score con boost por origen — preferimos real sobre sintético si las similitudes son cercanas. */
          adjustedScore: Number(r.similarity) + SOURCE_BOOST[src]
        };
      })
      .sort((a, b) => b.adjustedScore - a.adjustedScore);

    // Si tenemos contexto de producto, priorizar matches del mismo producto.
    if (productName) {
      const sameProduct = candidates.filter((c) => c.productName === productName);
      if (sameProduct.length >= k) {
        candidates = sameProduct;
      }
    }

    return candidates.slice(0, k).map((c) => ({
      incomingText: c.incomingText,
      outgoingText: c.outgoingText,
      productName: c.productName,
      similarity: c.similarity,
      source: c.source
    }));
  }
}
