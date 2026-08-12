import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ limit: vi.fn() }));

vi.mock("@upstash/redis", () => ({
  Redis: class Redis {
    constructor(options: unknown) {
      void options;
    }
  },
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class Ratelimit {
    static slidingWindow(attempts: number, window: string) {
      return { attempts, window };
    }
    constructor(options: unknown) {
      void options;
    }
    limit(key: string) {
      return mocks.limit(key);
    }
  },
}));

import { limitGlobalUpstream, limitRepository } from "@/lib/server/rate-limit";

describe("distributed upstream budgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  });

  it("meters repository and global work independently", async () => {
    mocks.limit.mockResolvedValue({
      success: true,
      reset: Date.now() + 60_000,
    });
    await expect(limitRepository("vercel/ms")).resolves.toMatchObject({
      success: true,
    });
    await expect(limitGlobalUpstream()).resolves.toMatchObject({
      success: true,
    });
    expect(mocks.limit.mock.calls).toEqual([["vercel/ms"], ["github"]]);
  });

  it("returns retry timing for a blocked budget", async () => {
    mocks.limit.mockResolvedValue({
      success: false,
      reset: Date.now() + 45_000,
    });
    await expect(limitRepository("vercel/ms")).resolves.toMatchObject({
      success: false,
      retryAfter: 45,
    });
  });
});
