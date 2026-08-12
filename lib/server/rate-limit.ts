import "server-only";

import { createHmac } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type LimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};
const LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;
const localCounters = new Map<string, { count: number; reset: number }>();

function redisFromEnvironment() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

export function hasDistributedStore() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

export function clientKey(request: Request) {
  const address =
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local";
  const secret =
    process.env.RATE_LIMIT_SALT ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    "local-development";
  return createHmac("sha256", secret)
    .update(address)
    .digest("hex")
    .slice(0, 24);
}

export async function limitAnalysis(request: Request): Promise<LimitResult> {
  const key = `analyze:${clientKey(request)}`;
  const redis = redisFromEnvironment();
  if (redis) {
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(LIMIT, "15 m"),
      prefix: "ctm:limit",
    });
    return limiter.limit(key);
  }
  if (process.env.VERCEL_ENV === "production")
    throw new Error("RATE_LIMIT_STORE_UNAVAILABLE");
  const now = Date.now();
  const current = localCounters.get(key);
  const counter =
    !current || current.reset <= now
      ? { count: 0, reset: now + WINDOW_MS }
      : current;
  counter.count += 1;
  localCounters.set(key, counter);
  return {
    success: counter.count <= LIMIT,
    limit: LIMIT,
    remaining: Math.max(0, LIMIT - counter.count),
    reset: counter.reset,
  };
}

async function distributedBudget(
  key: string,
  prefix: string,
  attempts: number,
  window: "15 m" | "1 h",
) {
  const redis = redisFromEnvironment();
  if (!redis) {
    if (process.env.VERCEL_ENV === "production")
      throw new Error("RATE_LIMIT_STORE_UNAVAILABLE");
    return { success: true, retryAfter: 0 };
  }
  const result = await new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(attempts, window),
    prefix,
  }).limit(key);
  return {
    success: result.success,
    retryAfter: result.success
      ? 0
      : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
  };
}

export function limitRepository(repository: string) {
  return distributedBudget(repository, "ctm:upstream:repository", 3, "15 m");
}

export function limitGlobalUpstream() {
  return distributedBudget("github", "ctm:upstream:global", 8, "1 h");
}

export function rateLimitHeaders(result: LimitResult) {
  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
    ...(result.success ? {} : { "Retry-After": String(retryAfter) }),
  };
}

export function resetLocalRateLimitsForTests() {
  localCounters.clear();
}
export function sharedRedis() {
  return redisFromEnvironment();
}
