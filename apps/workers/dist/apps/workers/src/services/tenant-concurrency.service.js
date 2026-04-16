"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantConcurrencyService = void 0;
const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ACQUIRE_TENANT_SLOT_LUA = `
local key = KEYS[1]
local max_slots = tonumber(ARGV[1])
local ttl_ms = tonumber(ARGV[2])
local current = tonumber(redis.call("GET", key) or "0")
if current >= max_slots then
  return 0
end
current = redis.call("INCR", key)
if current == 1 then
  redis.call("PEXPIRE", key, ttl_ms)
else
  redis.call("PEXPIRE", key, ttl_ms)
end
return 1
`;
const RELEASE_TENANT_SLOT_LUA = `
local key = KEYS[1]
local current = tonumber(redis.call("GET", key) or "0")
if current <= 1 then
  redis.call("DEL", key)
  return 0
end
return redis.call("DECR", key)
`;
class TenantConcurrencyService {
    redis;
    options;
    constructor(redis, options) {
        this.redis = redis;
        this.options = options;
    }
    async acquire(tenantId) {
        const key = `sender:tenant_slots:${tenantId}`;
        const startedAt = Date.now();
        while (Date.now() - startedAt < this.options.maxWaitMs) {
            const acquired = (await this.redis.eval(ACQUIRE_TENANT_SLOT_LUA, 1, key, String(this.options.maxPerTenant), String(this.options.slotTtlMs)));
            if (acquired === 1)
                return key;
            await sleep(this.options.waitMs);
        }
        throw new Error(`Timeout waiting tenant slot for ${tenantId}`);
    }
    async release(key) {
        await this.redis.eval(RELEASE_TENANT_SLOT_LUA, 1, key);
    }
}
exports.TenantConcurrencyService = TenantConcurrencyService;
