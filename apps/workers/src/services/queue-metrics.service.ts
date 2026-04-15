type MetricSnapshot = {
  enqueued: number;
  processing: number;
  completed: number;
  failed: number;
  retryScheduled: number;
};

export class QueueMetricsService {
  private readonly counters: MetricSnapshot = {
    enqueued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    retryScheduled: 0
  };

  constructor(private readonly queueName: string) {
    const intervalMs = Number(process.env.WORKER_METRICS_INTERVAL_MS ?? 30000);
    setInterval(() => {
      console.log(
        JSON.stringify({
          type: "queue_metrics",
          queue: this.queueName,
          ...this.counters,
          timestamp: new Date().toISOString()
        })
      );
    }, intervalMs);
  }

  onEnqueued(): void {
    this.counters.enqueued += 1;
  }

  onProcessing(): void {
    this.counters.processing += 1;
  }

  onCompleted(): void {
    this.counters.completed += 1;
  }

  onFailed(willRetry: boolean): void {
    this.counters.failed += 1;
    if (willRetry) this.counters.retryScheduled += 1;
  }
}
