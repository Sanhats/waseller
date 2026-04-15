import { Queue } from "bullmq";

export class AdaptiveBatcherService {
  private cachedAt = 0;
  private cachedBatch = 1;

  constructor(
    private readonly queue: Queue,
    private readonly options: {
      minBatch: number;
      maxBatch: number;
      backlogHigh: number;
      cacheMs: number;
    }
  ) {}

  async resolveBatchSize(): Promise<number> {
    const now = Date.now();
    if (now - this.cachedAt <= this.options.cacheMs) {
      return this.cachedBatch;
    }

    const counts = await this.queue.getJobCounts("waiting", "delayed", "active");
    const backlog = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
    const factor = Math.min(1, backlog / Math.max(this.options.backlogHigh, 1));
    const dynamic = Math.round(
      this.options.minBatch + factor * (this.options.maxBatch - this.options.minBatch)
    );

    this.cachedBatch = Math.max(this.options.minBatch, Math.min(dynamic, this.options.maxBatch));
    this.cachedAt = now;
    return this.cachedBatch;
  }
}
