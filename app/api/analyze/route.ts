import { NextResponse } from "next/server";
import {
  analyzeRequestSchema,
  type ApiError,
  type RepositoryAnalysis,
} from "@/lib/contracts";
import { canonicalRepositoryKey, parseRepositoryRef } from "@/lib/repository";
import { analyzeGitHubRepository, GitHubError } from "@/lib/server/github";
import {
  hasDistributedStore,
  limitAnalysis,
  rateLimitHeaders,
  sharedRedis,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 20;
export const dynamic = "force-dynamic";

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
  if (length > 1024)
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
    const body = await request.text();
    if (body.length > 1024)
      return errorResponse(
        "PAYLOAD_TOO_LARGE",
        "The request is too large.",
        413,
        headers,
      );
    payload = JSON.parse(body);
  } catch {
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
    const cached = await redis
      .get<RepositoryAnalysis>(cacheKey)
      .catch(() => null);
    if (cached)
      return NextResponse.json(cached, {
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
  try {
    const analysis = await analyzeGitHubRepository(ref);
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
  }
}
