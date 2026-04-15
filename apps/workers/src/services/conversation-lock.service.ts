import type IORedis from "ioredis";

const lockLuaRelease = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class ConversationLockService {
  constructor(
    private readonly redis: IORedis,
    private readonly ttlMs: number,
    private readonly waitMs: number
  ) {}

  async acquire(tenantId: string, phone: string): Promise<{ key: string; token: string }> {
    const key = `conversation:lock:${tenantId}:${phone}`;
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.waitMs) {
      const lockResult = await this.redis.set(key, token, "PX", this.ttlMs, "NX");
      if (lockResult === "OK") return { key, token };
      await sleep(40);
    }
    throw new Error(`Timeout waiting conversation lock for ${tenantId}:${phone}`);
  }

  async release(key: string, token: string): Promise<void> {
    await this.redis.eval(lockLuaRelease, 1, key, token);
  }
}
