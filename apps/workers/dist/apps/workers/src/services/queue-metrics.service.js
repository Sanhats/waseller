"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueMetricsService = void 0;
class QueueMetricsService {
    queueName;
    counters = {
        enqueued: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        retryScheduled: 0
    };
    constructor(queueName) {
        this.queueName = queueName;
        const intervalMs = Number(process.env.WORKER_METRICS_INTERVAL_MS ?? 30000);
        setInterval(() => {
            console.log(JSON.stringify({
                type: "queue_metrics",
                queue: this.queueName,
                ...this.counters,
                timestamp: new Date().toISOString()
            }));
        }, intervalMs);
    }
    onEnqueued() {
        this.counters.enqueued += 1;
    }
    onProcessing() {
        this.counters.processing += 1;
    }
    onCompleted() {
        this.counters.completed += 1;
    }
    onFailed(willRetry) {
        this.counters.failed += 1;
        if (willRetry)
            this.counters.retryScheduled += 1;
    }
}
exports.QueueMetricsService = QueueMetricsService;
