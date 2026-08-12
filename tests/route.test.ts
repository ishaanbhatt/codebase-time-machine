import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/analyze/route";
import { resetLocalRateLimitsForTests } from "@/lib/server/rate-limit";

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": "203.0.113.20",
      ...headers,
    },
  });
}

describe("POST /api/analyze", () => {
  const previousVercelEnvironment = process.env.VERCEL_ENV;

  beforeEach(() => {
    delete process.env.VERCEL_ENV;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetLocalRateLimitsForTests();
  });

  afterEach(() => {
    if (previousVercelEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnvironment;
  });

  it("requires JSON without consuming an analysis slot", async () => {
    const response = await POST(
      request("repository=vercel/ms", { "content-type": "text/plain" }),
    );
    expect(response.status).toBe(415);
    expect(response.headers.get("ratelimit-limit")).toBeNull();
  });

  it("rejects an oversized body even without a content-length header", async () => {
    const response = await POST(
      request(JSON.stringify({ repository: "a".repeat(1100) })),
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });

  it("counts multibyte request content in bytes", async () => {
    const response = await POST(
      request(JSON.stringify({ repository: "界".repeat(400) })),
    );
    expect(response.status).toBe(413);
  });

  it("returns stable errors for malformed JSON and unsupported hosts", async () => {
    const malformed = await POST(request("{"));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      error: { code: "INVALID_JSON" },
    });

    const unsupported = await POST(
      request(JSON.stringify({ repository: "https://example.com/org/repo" })),
    );
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toMatchObject({
      error: { code: "INVALID_REPOSITORY" },
    });
  });

  it("returns 429 and Retry-After on the sixth attempt", async () => {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await POST(request(JSON.stringify({ repository: "invalid" })));
    }
    expect(response?.status).toBe(429);
    expect(Number(response?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response?.headers.get("ratelimit-remaining")).toBe("0");
  });
});
