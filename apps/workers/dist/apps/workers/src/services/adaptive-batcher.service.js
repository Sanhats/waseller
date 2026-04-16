"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdaptiveBatcherService = void 0;
class AdaptiveBatcherService {
    queue;
    options;
    cachedAt = 0;
    cachedBatch = 1;
    constructor(queue, options) {
        this.queue = queue;
        this.options = options;
    }
    async resolveBatchSize() {
        const now = Date.now();
        if (now - this.cachedAt <= this.options.cacheMs) {
            return this.cachedBatch;
        }
        const counts = await this.queue.getJobCounts("waiting", "delayed", "active");
        const backlog = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
        const factor = Math.min(1, backlog / Math.max(this.options.backlogHigh, 1));
        const dynamic = Math.round(this.options.minBatch + factor * (this.options.maxBatch - this.options.minBatch));
        this.cachedBatch = Math.max(this.options.minBatch, Math.min(dynamic, this.options.maxBatch));
        this.cachedAt = now;
        return this.cachedBatch;
    }
}
exports.AdaptiveBatcherService = AdaptiveBatcherService;
