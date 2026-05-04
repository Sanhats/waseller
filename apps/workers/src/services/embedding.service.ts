/**
 * Wrapper sobre OpenAI embeddings. Usa `text-embedding-3-small` (1536 dims).
 * Tradeoff: dimensionalidad alta para mejor recall; costo ~ $0.02/1M tokens.
 *
 * Si `OPENAI_API_KEY` no está seteada, devuelve null y el RAG queda deshabilitado
 * (el copiloto sigue funcionando, solo sin few-shot examples).
 */
export class EmbeddingService {
  private readonly model = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
  private readonly apiKey = process.env.OPENAI_API_KEY;
  private readonly timeoutMs = Number(process.env.EMBEDDING_TIMEOUT_MS ?? 8000);

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  /** Embed un solo texto. Devuelve null si falla o no hay API key. */
  async embed(text: string): Promise<number[] | null> {
    if (!this.apiKey) return null;
    const trimmed = text.trim().slice(0, 8000);
    if (!trimmed) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ model: this.model, input: trimmed }),
        signal: controller.signal
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const vec = body.data?.[0]?.embedding;
      return Array.isArray(vec) && vec.length > 0 ? vec : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Embed varios textos en una sola llamada (más barato). */
  async embedMany(texts: string[]): Promise<Array<number[] | null>> {
    if (!this.apiKey) return texts.map(() => null);
    const filtered = texts.map((t) => t.trim().slice(0, 8000));
    if (filtered.every((t) => !t)) return texts.map(() => null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs * 2);
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ model: this.model, input: filtered }),
        signal: controller.signal
      });
      if (!res.ok) return texts.map(() => null);
      const body = (await res.json()) as {
        data?: Array<{ embedding?: number[]; index?: number }>;
      };
      const result = new Array<number[] | null>(texts.length).fill(null);
      for (const item of body.data ?? []) {
        const idx = typeof item.index === "number" ? item.index : -1;
        if (idx >= 0 && idx < result.length && Array.isArray(item.embedding)) {
          result[idx] = item.embedding;
        }
      }
      return result;
    } catch {
      return texts.map(() => null);
    } finally {
      clearTimeout(timeout);
    }
  }

  modelName(): string {
    return this.model;
  }
}
