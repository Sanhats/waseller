import { Job, Worker } from "bullmq";
import { QueueNames, redisConnection } from "../../../packages/queue/src";
import { StyleProfileService } from "./services/style-profile.service";

const styleProfileService = new StyleProfileService();

type StyleProfileRecomputeJob = { tenantId: string };

export const styleProfileRecomputeWorker = new Worker<StyleProfileRecomputeJob>(
  QueueNames.styleProfileRecompute,
  async (job: Job<StyleProfileRecomputeJob>) => {
    const { tenantId } = job.data;
    if (!tenantId) return;
    await styleProfileService.recompute(tenantId);
  },
  {
    connection: redisConnection,
    concurrency: 1
  }
);
