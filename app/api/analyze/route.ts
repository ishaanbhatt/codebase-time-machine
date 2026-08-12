import { NextResponse } from "next/server";
import {
  analyzeRequestSchema,
  repositoryAnalysisSchema,
  type ApiError,
} from "@/lib/contracts";
import { canonicalRepositoryKey, parseRepositoryRef } from "@/lib/repository";
import { analyzeGitHubRepository, GitHubError } from "@/lib/server/github";
import {
  hasDistributedStore,
  limitAnalysis,
  limitGlobalUpstream,
  limitRepository,
  rateLimitHeaders,
  sharedRedis,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 20;
export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 1024;
const MAX_RESPONSE_BYTES = 3_500_000;

async function readBoundedBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error("PAYLOAD_TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  headers?: HeadersInit,
  retryAfter?: number,
) {
  return NextResponse.json<ApiError>(
    { error: { code, message, ...(retryAfter ? { retryAfter } : {}) } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_REQUEST_BYTES)
    return errorResponse("PAYLOAD_TOO_LARGE", "The request is too large.", 413);
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return errorResponse(
      "UNSUPPORTED_MEDIA_TYPE",
      "Send a JSON request containing a repository field.",
      415,
    );
  let limit;
  try {
    limit = await limitAnalysis(request);
  } catch {
    return errorResponse(
      "RATE_LIMIT_UNAVAILABLE",
      "Repository analysis is temporarily paused while its safety controls recover.",
      503,
    );
  }
  const headers = rateLimitHeaders(limit);
  if (!limit.success)
    return errorResponse(
      "RATE_LIMITED",
      "Too many analyses were requested. Explore the demo while you wait.",
      429,
      headers,
      Number(headers["Retry-After"]),
    );
  let payload: unknown;
  try {
    const body = await readBoundedBody(request);
    payload = JSON.parse(body);
  } catch (error) {
    if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE")
      return errorResponse(
        "PAYLOAD_TOO_LARGE",
        "The request is too large.",
        413,
        headers,
      );
    return errorResponse(
      "INVALID_JSON",
      "The request body is not valid JSON.",
      400,
      headers,
    );
  }
  const parsed = analyzeRequestSchema.safeParse(payload);
  if (!parsed.success)
    return errorResponse(
      "INVALID_REQUEST",
      "Enter a public GitHub URL such as github.com/vercel/next.js.",
      400,
      headers,
    );
  const ref = parseRepositoryRef(parsed.data.repository);
  if (!ref)
    return errorResponse(
      "INVALID_REPOSITORY",
      "Use an owner/repository pair or a public github.com URL.",
      400,
      headers,
    );
  const redis = sharedRedis();
  const cacheKey = `ctm:analysis:v1:${canonicalRepositoryKey(ref)}`;
  if (redis) {
    const cached = await redis.get<unknown>(cacheKey).catch(() => null);
    const validCached = repositoryAnalysisSchema.safeParse(cached);
    if (validCached.success)
      return NextResponse.json(validCached.data, {
        headers: {
          ...headers,
          "Cache-Control": "private, no-store",
          "X-Analysis-Cache": "HIT",
        },
      });
  } else if (process.env.VERCEL_ENV === "production" && !hasDistributedStore())
    return errorResponse(
      "CACHE_UNAVAILABLE",
      "Repository analysis is temporarily unavailable.",
      503,
      headers,
    );
  let repositoryLimit;
  try {
    repositoryLimit = await limitRepository(canonicalRepositoryKey(ref));
  } catch {
    return errorResponse(
      "RATE_LIMIT_UNAVAILABLE",
      "Repository analysis is temporarily paused while its safety controls recover.",
      503,
      headers,
    );
  }
  if (!repositoryLimit.success)
    return errorResponse(
      "UPSTREAM_LIMITED",
      "The shared GitHub analysis budget is resting. Explore the demo and try again later.",
      429,
      { ...headers, "Retry-After": String(repositoryLimit.retryAfter) },
      repositoryLimit.retryAfter,
    );

  const lockKey = `${cacheKey}:lock`;
  const lockToken = crypto.randomUUID();
  let ownsLock = false;
  if (redis) {
    let acquired;
    try {
      acquired = await redis.set(lockKey, lockToken, { nx: true, ex: 18 });
    } catch {
      return errorResponse(
        "RATE_LIMIT_UNAVAILABLE",
        "Repository analysis is temporarily paused while its safety controls recover.",
        503,
        headers,
      );
    }
    ownsLock = acquired === "OK";
    if (!ownsLock)
      return errorResponse(
        "ANALYSIS_IN_PROGRESS",
        "This repository is already being analyzed. Try again in a few seconds.",
        409,
        { ...headers, "Retry-After": "3" },
        3,
      );
  }
  try {
    if (redis) {
      const rechecked = await redis.get<unknown>(cacheKey).catch(() => null);
      const validRechecked = repositoryAnalysisSchema.safeParse(rechecked);
      if (validRechecked.success)
        return NextResponse.json(validRechecked.data, {
          headers: {
            ...headers,
            "Cache-Control": "private, no-store",
            "X-Analysis-Cache": "HIT",
          },
        });
    }
    let globalLimit;
    try {
      globalLimit = await limitGlobalUpstream();
    } catch {
      return errorResponse(
        "RATE_LIMIT_UNAVAILABLE",
        "Repository analysis is temporarily paused while its safety controls recover.",
        503,
        headers,
      );
    }
    if (!globalLimit.success)
      return errorResponse(
        "UPSTREAM_LIMITED",
        "The shared GitHub analysis budget is resting. Explore the demo and try again later.",
        429,
        { ...headers, "Retry-After": String(globalLimit.retryAfter) },
        globalLimit.retryAfter,
      );
    const rawAnalysis = await analyzeGitHubRepository(ref);
    const analysis = repositoryAnalysisSchema.parse(rawAnalysis);
    if (Buffer.byteLength(JSON.stringify(analysis)) > MAX_RESPONSE_BYTES)
      return errorResponse(
        "ANALYSIS_TOO_LARGE",
        "This repository is too large for a safe interactive analysis.",
        422,
        headers,
      );
    if (redis)
      await redis.set(cacheKey, analysis, { ex: 900 }).catch(() => undefined);
    return NextResponse.json(analysis, {
      headers: {
        ...headers,
        "Cache-Control": "private, no-store",
        "X-Analysis-Cache": "MISS",
      },
    });
  } catch (error) {
    if (error instanceof GitHubError)
      return errorResponse(
        error.code,
        error.message,
        error.status,
        {
          ...headers,
          ...(error.retryAfter
            ? { "Retry-After": String(error.retryAfter) }
            : {}),
        },
        error.retryAfter,
      );
    return errorResponse(
      "ANALYSIS_FAILED",
      "The repository could not be analyzed safely. Try another public repository.",
      502,
      headers,
    );
  } finally {
    if (redis && ownsLock)
      await redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          [lockKey],
          [lockToken],
        )
        .catch(() => undefined);
  }
}
