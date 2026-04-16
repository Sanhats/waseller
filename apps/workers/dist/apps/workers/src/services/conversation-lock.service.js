"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationLockService = void 0;
const lockLuaRelease = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;
const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class ConversationLockService {
    redis;
    ttlMs;
    waitMs;
    constructor(redis, ttlMs, waitMs) {
        this.redis = redis;
        this.ttlMs = ttlMs;
        this.waitMs = waitMs;
    }
    async acquire(tenantId, phone) {
        const key = `conversation:lock:${tenantId}:${phone}`;
        const token = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
        const startedAt = Date.now();
        while (Date.now() - startedAt < this.waitMs) {
            const lockResult = await this.redis.set(key, token, "PX", this.ttlMs, "NX");
            if (lockResult === "OK")
                return { key, token };
            await sleep(40);
        }
        throw new Error(`Timeout waiting conversation lock for ${tenantId}:${phone}`);
    }
    async release(key, token) {
        await this.redis.eval(lockLuaRelease, 1, key, token);
    }
}
exports.ConversationLockService = ConversationLockService;
