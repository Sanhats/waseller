import { Redis } from "ioredis";

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ACQUIRE_TOKEN_LUA = `
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local refill_per_sec = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])

local data = redis.call("HMGET", key, "tokens", "last_refill_ms")
local tokens = tonumber(data[1])
local last_refill = tonumber(data[2])

if tokens == nil then
  tokens = capacity
end
if last_refill == nil then
  last_refill = now_ms
end

local elapsed = now_ms - last_refill
if elapsed < 0 then
  elapsed = 0
end

local refill = (elapsed / 1000.0) * refill_per_sec
tokens = math.min(capacity, tokens + refill)

local granted = 0
if tokens >= 1 then
  tokens = tokens - 1
  granted = 1
end

redis.call("HMSET", key, "tokens", tokens, "last_refill_ms", now_ms)
redis.call("PEXPIRE", key, 60000)

return granted
`;

export class GlobalThrottleService {
  constructor(
    private readonly redis: Redis,
    private readonly options: {
      tokensPerSecond: number;
      burst: number;
      waitMs: number;
    }
  ) {}

  async acquire(): Promise<void> {
    const key = "sender:global:token_bucket";
    while (true) {
      const now = Date.now();
      const granted = (await this.redis.eval(
        ACQUIRE_TOKEN_LUA,
        1,
        key,
        String(now),
        String(this.options.tokensPerSecond),
        String(this.options.burst)
      )) as number;
      if (granted === 1) return;
      await sleep(this.options.waitMs);
    }
  }
}
