import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clientKey,
  limitAnalysis,
  rateLimitHeaders,
  resetLocalRateLimitsForTests,
} from "@/lib/server/rate-limit";

const ORIGINAL_ENV = { ...process.env };

describe("local analysis rate limiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    process.env = {
      ...ORIGINAL_ENV,
      VERCEL_ENV: "development",
      RATE_LIMIT_SALT: "test-only-salt",
    };
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetLocalRateLimitsForTests();
  });

  afterEach(() => {
    resetLocalRateLimitsForTests();
    process.env = { ...ORIGINAL_ENV };
    vi.useRealTimers();
  });

  it("allows exactly five requests and rejects N+1 with retry metadata", async () => {
    const request = new Request("https://example.test/api/analyze", {
      headers: { "x-vercel-forwarded-for": "203.0.113.7" },
    });

    const results = [];
    for (let index = 0; index < 6; index += 1)
      results.push(await limitAnalysis(request));

    expect(results.map((result) => result.success)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(results.map((result) => result.remaining)).toEqual([
      4, 3, 2, 1, 0, 0,
    ]);
    expect(results.every((result) => result.limit === 5)).toBe(true);
    expect(rateLimitHeaders(results[4])).not.toHaveProperty("Retry-After");
    expect(rateLimitHeaders(results[5])).toMatchObject({
      "RateLimit-Limit": "5",
      "RateLimit-Remaining": "0",
      "Retry-After": "900",
    });
  });

  it("starts a fresh window after the reset boundary", async () => {
    const request = new Request("https://example.test/api/analyze", {
      headers: { "x-vercel-forwarded-for": "203.0.113.8" },
    });
    for (let index = 0; index < 6; index += 1) await limitAnalysis(request);

    vi.advanceTimersByTime(15 * 60 * 1000);
    await expect(limitAnalysis(request)).resolves.toMatchObject({
      success: true,
      remaining: 4,
    });
  });

  it("isolates counters by hashed client identity and prefers Vercel routing context", async () => {
    const first = new Request("https://example.test/api/analyze", {
      headers: {
        "x-vercel-forwarded-for": "203.0.113.10",
        "x-forwarded-for": "198.51.100.1",
      },
    });
    const second = new Request("https://example.test/api/analyze", {
      headers: {
        "x-vercel-forwarded-for": "203.0.113.11",
        "x-forwarded-for": "198.51.100.1",
      },
    });

    expect(clientKey(first)).not.toBe(clientKey(second));
    for (let index = 0; index < 5; index += 1) await limitAnalysis(first);
    await expect(limitAnalysis(first)).resolves.toMatchObject({
      success: false,
    });
    await expect(limitAnalysis(second)).resolves.toMatchObject({
      success: true,
      remaining: 4,
    });
  });

  it("fails closed in production without the distributed store", async () => {
    process.env.VERCEL_ENV = "production";
    const request = new Request("https://example.test/api/analyze");
    await expect(limitAnalysis(request)).rejects.toThrow(
      "RATE_LIMIT_STORE_UNAVAILABLE",
    );
  });
});
