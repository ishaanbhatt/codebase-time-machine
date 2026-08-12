import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoAnalysis } from "@/lib/demo";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  eval: vi.fn(),
  analyze: vi.fn(),
  repositoryLimit: vi.fn(),
  globalLimit: vi.fn(),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  hasDistributedStore: () => true,
  limitAnalysis: vi.fn(async () => ({
    success: true,
    limit: 5,
    remaining: 4,
    reset: Date.now() + 900_000,
  })),
  limitRepository: mocks.repositoryLimit,
  limitGlobalUpstream: mocks.globalLimit,
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
    mocks.repositoryLimit.mockResolvedValue({ success: true, retryAfter: 0 });
    mocks.globalLimit.mockResolvedValue({ success: true, retryAfter: 0 });
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
    expect(mocks.globalLimit).not.toHaveBeenCalled();
  });

  it("returns 503 when the lock service fails", async () => {
    mocks.get.mockResolvedValue(null);
    mocks.set.mockRejectedValue(new Error("redis unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMIT_UNAVAILABLE" },
    });
    expect(mocks.globalLimit).not.toHaveBeenCalled();
  });

  it("ignores malformed cached data and refreshes it safely", async () => {
    mocks.get.mockResolvedValue({ schemaVersion: "stale" });
    mocks.set.mockResolvedValue("OK");
    mocks.analyze.mockResolvedValue(demoAnalysis);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-analysis-cache")).toBe("MISS");
  });

  it("rejects a schema-valid analysis above the response byte ceiling", async () => {
    mocks.get.mockResolvedValue(null);
    mocks.set.mockResolvedValue("OK");
    const files = Array.from({ length: 1500 }, (_, index) => {
      const path = `${String(index).padStart(4, "0")}-${"x".repeat(230)}.ts`;
      return {
        path,
        name: path,
        directory: "root",
        extension: "ts",
        size: 1,
        changeScore: 0,
      };
    });
    mocks.analyze.mockResolvedValue({
      ...demoAnalysis,
      snapshots: demoAnalysis.snapshots.map((snapshot) => ({
        ...snapshot,
        files,
        totalFiles: files.length,
      })),
    });
    const response = await POST(request());
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ANALYSIS_TOO_LARGE" },
    });
  });
});
