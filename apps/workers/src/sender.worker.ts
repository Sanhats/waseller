import { Job, Worker } from "bullmq";
import { OutgoingJobV1, outgoingQueue, QueueNames, redisConnection } from "../../../packages/queue/src";
import { prisma } from "../../../packages/db/src";
import { requireWhatsappServiceBaseUrl, SMART_RETRY_DELAYS_MS } from "../../../packages/shared/src";
import { QueueMetricsService } from "./services/queue-metrics.service";
import { GlobalThrottleService } from "./services/global-throttle.service";
import { AdaptiveBatcherService } from "./services/adaptive-batcher.service";
import { TenantConcurrencyService } from "./services/tenant-concurrency.service";

const senderState = new Map<string, { sentCount: number; lastSentAt: number }>();
const senderConfigCache = new Map<
  string,
  {
    rateMs: number;
    pauseEvery: number;
    pauseMs: number;
    expiresAt: number;
  }
>();
let tenantRateColumnsAvailable: boolean | null = null;
const senderMetrics = new QueueMetricsService(QueueNames.outgoingMessages);

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_RATE_MS = Number(process.env.SENDER_RATE_MS ?? 500);
const DEFAULT_PAUSE_EVERY = Number(process.env.SENDER_PAUSE_EVERY ?? 20);
const DEFAULT_PAUSE_MS = Number(process.env.SENDER_PAUSE_MS ?? 2500);
const RATE_JITTER_MS = Number(process.env.SENDER_JITTER_MS ?? 200);
const CONFIG_CACHE_TTL_MS = Number(process.env.SENDER_CONFIG_CACHE_TTL_MS ?? 30000);
const PHONE_LOCK_TTL_MS = Number(process.env.SENDER_LOCK_TTL_MS ?? 20000);
const PHONE_LOCK_WAIT_MS = Number(process.env.SENDER_LOCK_WAIT_MS ?? 8000);
const SENDER_GLOBAL_TPS = Number(process.env.SENDER_GLOBAL_TPS ?? 4);
const SENDER_GLOBAL_BURST = Number(process.env.SENDER_GLOBAL_BURST ?? 8);
const SENDER_GLOBAL_WAIT_MS = Number(process.env.SENDER_GLOBAL_WAIT_MS ?? 120);
const SENDER_TENANT_MAX_CONCURRENCY = Number(process.env.SENDER_TENANT_MAX_CONCURRENCY ?? 2);
const SENDER_TENANT_SLOT_TTL_MS = Number(process.env.SENDER_TENANT_SLOT_TTL_MS ?? 30000);
const SENDER_TENANT_SLOT_WAIT_MS = Number(process.env.SENDER_TENANT_SLOT_WAIT_MS ?? 60);
const SENDER_TENANT_SLOT_MAX_WAIT_MS = Number(process.env.SENDER_TENANT_SLOT_MAX_WAIT_MS ?? 12000);
const SENDER_BATCH_MIN = Number(process.env.SENDER_BATCH_MIN ?? 1);
const SENDER_BATCH_MAX = Number(process.env.SENDER_BATCH_MAX ?? 6);
const SENDER_BATCH_BACKLOG_HIGH = Number(process.env.SENDER_BATCH_BACKLOG_HIGH ?? 120);
const SENDER_BATCH_CACHE_MS = Number(process.env.SENDER_BATCH_CACHE_MS ?? 250);

const globalThrottle = new GlobalThrottleService(redisConnection, {
  tokensPerSecond: Math.max(SENDER_GLOBAL_TPS, 1),
  burst: Math.max(SENDER_GLOBAL_BURST, 1),
  waitMs: Math.max(SENDER_GLOBAL_WAIT_MS, 10)
});

const adaptiveBatcher = new AdaptiveBatcherService(outgoingQueue, {
  minBatch: Math.max(SENDER_BATCH_MIN, 1),
  maxBatch: Math.max(SENDER_BATCH_MAX, 1),
  backlogHigh: Math.max(SENDER_BATCH_BACKLOG_HIGH, 1),
  cacheMs: Math.max(SENDER_BATCH_CACHE_MS, 50)
});

const tenantConcurrency = new TenantConcurrencyService(redisConnection, {
  maxPerTenant: Math.max(SENDER_TENANT_MAX_CONCURRENCY, 1),
  slotTtlMs: Math.max(SENDER_TENANT_SLOT_TTL_MS, 1000),
  waitMs: Math.max(SENDER_TENANT_SLOT_WAIT_MS, 20),
  maxWaitMs: Math.max(SENDER_TENANT_SLOT_MAX_WAIT_MS, 500)
});

const lockLuaRelease = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const clamp = (value: number, min: number): number => Math.max(Number.isFinite(value) ? value : min, min);

const checkTenantRateColumns = async (): Promise<boolean> => {
  if (tenantRateColumnsAvailable !== null) return tenantRateColumnsAvailable;

  try {
    const rows = (await prisma.$queryRawUnsafe(`
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'tenants'
          and column_name = 'sender_rate_ms'
      ) as "exists"
    `)) as Array<{ exists: boolean }>;
    tenantRateColumnsAvailable = Boolean(rows?.[0]?.exists);
  } catch {
    tenantRateColumnsAvailable = false;
  }

  return tenantRateColumnsAvailable;
};

const resolveTenantSenderConfig = async (
  tenantId: string
): Promise<{ rateMs: number; pauseEvery: number; pauseMs: number }> => {
  const now = Date.now();
  const cached = senderConfigCache.get(tenantId);
  if (cached && cached.expiresAt > now) {
    return {
      rateMs: cached.rateMs,
      pauseEvery: cached.pauseEvery,
      pauseMs: cached.pauseMs
    };
  }

  let tenant: {
    senderRateMs?: number;
    senderPauseEvery?: number;
    senderPauseMs?: number;
  } | null = null;

  if (await checkTenantRateColumns()) {
    tenant = await prisma.tenant.findUnique({
      where: { id: tenantId }
    });
  }

  const config = {
    rateMs: clamp(Number(tenant?.senderRateMs ?? DEFAULT_RATE_MS), 50),
    pauseEvery: clamp(Number(tenant?.senderPauseEvery ?? DEFAULT_PAUSE_EVERY), 1),
    pauseMs: clamp(Number(tenant?.senderPauseMs ?? DEFAULT_PAUSE_MS), 0)
  };

  senderConfigCache.set(tenantId, {
    ...config,
    expiresAt: now + CONFIG_CACHE_TTL_MS
  });

  return config;
};

const acquirePhoneLock = async (tenantId: string, phone: string): Promise<{ key: string; token: string }> => {
  const key = `sender:lock:${tenantId}:${phone}`;
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < PHONE_LOCK_WAIT_MS) {
    const lockResult = await redisConnection.set(key, token, "PX", PHONE_LOCK_TTL_MS, "NX");
    if (lockResult === "OK") return { key, token };
    await sleep(50);
  }

  throw new Error(`Timeout waiting lock for ${tenantId}:${phone}`);
};

const releasePhoneLock = async (key: string, token: string): Promise<void> => {
  await redisConnection.eval(lockLuaRelease, 1, key, token);
};

export const senderWorker = new Worker<OutgoingJobV1>(
  QueueNames.outgoingMessages,
  async (job: Job<OutgoingJobV1>) => {
    const { tenantId, phone, message, imageUrl, correlationId, dedupeKey } = job.data;
    const tenantSlotKey = await tenantConcurrency.acquire(tenantId);
    const lock = await acquirePhoneLock(tenantId, phone);

    try {
      await globalThrottle.acquire();
      const config = await resolveTenantSenderConfig(tenantId);
      const current = senderState.get(tenantId) ?? { sentCount: 0, lastSentAt: 0, batchRemaining: 0 };
      const state: { sentCount: number; lastSentAt: number; batchRemaining: number } = {
        sentCount: current.sentCount,
        lastSentAt: current.lastSentAt,
        batchRemaining: (current as { batchRemaining?: number }).batchRemaining ?? 0
      };
      const selectedBatchSize = await adaptiveBatcher.resolveBatchSize();
      if (state.batchRemaining <= 0) {
        state.batchRemaining = selectedBatchSize;
      }
      const isBatchContinuation = state.batchRemaining < selectedBatchSize;

      if (state.sentCount > 0 && state.sentCount % config.pauseEvery === 0) {
        await sleep(config.pauseMs);
      }

      const elapsedSinceLastSend = Date.now() - state.lastSentAt;
      const rateBase = isBatchContinuation ? Math.floor(config.rateMs * 0.2) : config.rateMs;
      const waitForRateLimit = Math.max(rateBase - elapsedSinceLastSend, 0);
      const jitter = Math.floor(Math.random() * (RATE_JITTER_MS + 1));
      await sleep(waitForRateLimit + jitter);

      const whatsappServiceUrl = requireWhatsappServiceBaseUrl();
      const response = await fetch(`${whatsappServiceUrl}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          tenantId,
          phone,
          message,
          imageUrl
        })
      });

      if (!response.ok) {
        const reason = await response.text();
        throw new Error(`WhatsApp send failed: ${reason}`);
      }

      state.sentCount += 1;
      state.lastSentAt = Date.now();
      state.batchRemaining = Math.max((state.batchRemaining ?? 1) - 1, 0);
      senderState.set(tenantId, state);

      try {
        await prisma.message.create({
          data: {
            tenantId,
            phone,
            message,
            direction: "outgoing",
            correlationId,
            dedupeKey
          }
        });
      } catch {
        // Backward-compatible write for DBs without new message columns.
        await prisma.message.create({
          data: {
            tenantId,
            phone,
            message,
            direction: "outgoing"
          }
        });
      }
    } finally {
      await releasePhoneLock(lock.key, lock.token);
      await tenantConcurrency.release(tenantSlotKey);
    }
  },
  {
    connection: redisConnection,
    concurrency: Number(process.env.SENDER_CONCURRENCY ?? 2),
    settings: {
      backoffStrategy: (attemptsMade, type) => {
        if (type !== "smart") return 1000;
        const index = Math.max(0, Math.min(attemptsMade - 1, SMART_RETRY_DELAYS_MS.length - 1));
        return SMART_RETRY_DELAYS_MS[index];
      }
    }
  }
);

senderWorker.on("active", () => {
  senderMetrics.onProcessing();
});

senderWorker.on("completed", () => {
  senderMetrics.onCompleted();
});

senderWorker.on("failed", (job) => {
  const attempts = job?.opts?.attempts ?? 1;
  const willRetry = (job?.attemptsMade ?? 0) < attempts;
  senderMetrics.onFailed(willRetry);
});
