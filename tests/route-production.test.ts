import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoAnalysis } from "@/lib/demo";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  eval: vi.fn(),
  analyze: vi.fn(),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  hasDistributedStore: () => true,
  limitAnalysis: vi.fn(async () => ({
    success: true,
    limit: 5,
    remaining: 4,
    reset: Date.now() + 900_000,
  })),
  limitUpstream: vi.fn(async () => ({ success: true, retryAfter: 0 })),
  rateLimitHeaders: () => ({
    "RateLimit-Limit": "5",
    "RateLimit-Remaining": "4",
    "RateLimit-Reset": String(Math.ceil((Date.now() + 900_000) / 1000)),
  }),
  sharedRedis: () => ({ get: mocks.get, set: mocks.set, eval: mocks.eval }),
}));

vi.mock("@/lib/server/github", () => ({
  GitHubError: class GitHubError extends Error {},
  analyzeGitHubRepository: mocks.analyze,
}));

import { POST } from "@/app/api/analyze/route";

function request() {
  return new Request("https://example.test/api/analyze", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": "203.0.113.50",
    },
    body: JSON.stringify({ repository: "vercel/ms" }),
  });
}

describe("production cache route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_ENV = "production";
    mocks.eval.mockResolvedValue(1);
  });

  it("returns a schema-valid cache hit without calling GitHub", async () => {
    mocks.get.mockResolvedValue(demoAnalysis);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-analysis-cache")).toBe("HIT");
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("locks, analyzes, caches, and unlocks a miss", async () => {
    mocks.get.mockResolvedValue(null);
    mocks.set.mockResolvedValue("OK");
    mocks.analyze.mockResolvedValue(demoAnalysis);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-analysis-cache")).toBe("MISS");
    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(mocks.set).toHaveBeenCalledTimes(2);
    expect(mocks.eval).toHaveBeenCalledOnce();
  });

  it("rejects a cold-cache stampede while another analysis owns the lock", async () => {
    mocks.get.mockResolvedValue(null);
    mocks.set.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ANALYSIS_IN_PROGRESS", retryAfter: 3 },
    });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("ignores malformed cached data and refreshes it safely", async () => {
    mocks.get.mockResolvedValue({ schemaVersion: "stale" });
    mocks.set.mockResolvedValue("OK");
    mocks.analyze.mockResolvedValue(demoAnalysis);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-analysis-cache")).toBe("MISS");
  });
});
