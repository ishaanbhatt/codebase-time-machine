import "server-only";

import { z } from "zod";
import {
  analysisLimits,
  buildContributors,
  buildMilestones,
  buildSnapshots,
  type CommitInput,
  type TreeInput,
} from "@/lib/analyzer";
import type { RepositoryAnalysis } from "@/lib/contracts";
import type { RepositoryRef } from "@/lib/repository";

const API_ROOT = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 8_000;
const ANALYSIS_TIMEOUT_MS = 18_000;
const DEFAULT_RESPONSE_LIMIT = 1_500_000;
const TREE_RESPONSE_LIMIT = 7_500_000;
const repoSchema = z.object({
  name: z.string().max(100),
  full_name: z.string().max(201),
  description: z.string().max(500).nullable(),
  html_url: z.string().url().max(500),
  default_branch: z.string().max(240),
  language: z.string().max(100).nullable(),
  stargazers_count: z.number(),
  forks_count: z.number(),
  updated_at: z.string(),
  private: z.boolean(),
});
const commitSchema = z.object({
  sha: z.string().max(100),
  html_url: z.string().url().max(500),
  commit: z.object({
    message: z.string().max(100_000),
    author: z
      .object({ name: z.string().max(200), date: z.string().max(50) })
      .nullable(),
    committer: z
      .object({ name: z.string().max(200), date: z.string().max(50) })
      .nullable(),
    tree: z.object({ sha: z.string().max(100) }),
  }),
  author: z
    .object({
      login: z.string().max(100),
      avatar_url: z.string().url().max(500),
    })
    .nullable(),
});
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z
    .array(
      z.object({
        path: z.string().max(240),
        type: z.enum(["blob", "tree", "commit"]),
        size: z.number().optional(),
      }),
    )
    .max(100_000),
});

export class GitHubError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "codebase-time-machine/0.1",
    ...(process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {}),
  };
}

async function readBoundedJson(response: Response, limit: number) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new GitHubError(
          "GITHUB_RESPONSE_TOO_LARGE",
          "This repository is too large for a safe interactive analysis.",
          422,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    if (error instanceof GitHubError) throw error;
    if (error instanceof Error && error.name === "AbortError")
      throw new GitHubError(
        "GITHUB_TIMEOUT",
        "GitHub took too long to respond. Please try again.",
        504,
      );
    throw new GitHubError(
      "GITHUB_INVALID_RESPONSE",
      "GitHub returned data that could not be analyzed safely.",
      502,
    );
  } finally {
    reader.releaseLock();
  }
}

async function githubJson(
  path: string,
  responseLimit = DEFAULT_RESPONSE_LIMIT,
  deadline = Date.now() + ANALYSIS_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const remaining = deadline - Date.now();
  if (remaining <= 0)
    throw new GitHubError(
      "GITHUB_TIMEOUT",
      "GitHub took too long to respond. Please try again.",
      504,
    );
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(REQUEST_TIMEOUT_MS, remaining),
  );
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      headers: githubHeaders(),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status === 404)
        throw new GitHubError(
          "REPOSITORY_NOT_FOUND",
          "This public repository could not be found.",
          404,
        );
      const rateRemaining = response.headers.get("x-ratelimit-remaining");
      if (
        response.status === 429 ||
        (response.status === 403 && rateRemaining === "0")
      ) {
        const retryHeader = response.headers.get("retry-after");
        const resetHeader = response.headers.get("x-ratelimit-reset");
        const resetAt = resetHeader ? Number(resetHeader) * 1000 : Number.NaN;
        const retryAfter = retryHeader
          ? Math.max(1, Number(retryHeader) || 60)
          : Number.isFinite(resetAt) && resetAt > Date.now()
            ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
            : 60;
        throw new GitHubError(
          "GITHUB_RATE_LIMITED",
          "GitHub's request limit has been reached. Try again later or explore the demo.",
          503,
          retryAfter,
        );
      }
      throw new GitHubError(
        "GITHUB_ERROR",
        "GitHub could not complete the repository analysis.",
        response.status >= 500 ? 502 : 422,
      );
    }
    return await readBoundedJson(response, responseLimit);
  } catch (error) {
    if (error instanceof GitHubError) throw error;
    if (error instanceof Error && error.name === "AbortError")
      throw new GitHubError(
        "GITHUB_TIMEOUT",
        "GitHub took too long to respond. Please try again.",
        504,
      );
    throw new GitHubError(
      "GITHUB_UNAVAILABLE",
      "GitHub is temporarily unavailable.",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function selectCheckpoints(commits: CommitInput[]) {
  if (commits.length <= analysisLimits.snapshots) return commits;
  return Array.from(
    { length: analysisLimits.snapshots },
    (_, index) =>
      commits[
        Math.round(
          (index * (commits.length - 1)) / (analysisLimits.snapshots - 1),
        )
      ],
  );
}

export async function analyzeGitHubRepository(
  ref: RepositoryRef,
): Promise<RepositoryAnalysis> {
  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS;
  const owner = encodeURIComponent(ref.owner);
  const repo = encodeURIComponent(ref.repo);
  const repoPayload = await githubJson(
    `/repos/${owner}/${repo}`,
    DEFAULT_RESPONSE_LIMIT,
    deadline,
  );
  const repository = repoSchema.parse(repoPayload);
  if (repository.private)
    throw new GitHubError(
      "PRIVATE_REPOSITORY",
      "Only public repositories are supported.",
      403,
    );
  const commitPayload = await githubJson(
    `/repos/${owner}/${repo}/commits?per_page=${analysisLimits.history}`,
    DEFAULT_RESPONSE_LIMIT,
    deadline,
  );
  const parsedCommits = z.array(commitSchema).parse(commitPayload);
  if (!parsedCommits.length)
    throw new GitHubError(
      "EMPTY_REPOSITORY",
      "This repository does not have commit history to explore.",
      422,
    );
  const commits: CommitInput[] = parsedCommits
    .map((item) => ({
      sha: item.sha,
      date:
        item.commit.author?.date ??
        item.commit.committer?.date ??
        repository.updated_at,
      message: item.commit.message.split("\n")[0].slice(0, 200),
      author:
        item.author?.login ??
        item.commit.author?.name ??
        item.commit.committer?.name ??
        "Unknown contributor",
      avatarUrl: item.author?.avatar_url,
      treeSha: item.commit.tree.sha,
    }))
    .sort((a, b) =>
      a.date < b.date
        ? -1
        : a.date > b.date
          ? 1
          : a.sha < b.sha
            ? -1
            : a.sha > b.sha
              ? 1
              : 0,
    );
  const checkpoints = selectCheckpoints(commits);
  const payloadByTree = new Map<string, unknown>();
  for (const checkpoint of checkpoints) {
    if (!payloadByTree.has(checkpoint.treeSha))
      payloadByTree.set(
        checkpoint.treeSha,
        await githubJson(
          `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(checkpoint.treeSha)}?recursive=1`,
          TREE_RESPONSE_LIMIT,
          deadline,
        ),
      );
  }
  const trees: TreeInput[] = checkpoints.map((checkpoint) => {
    const payload = payloadByTree.get(checkpoint.treeSha);
    const parsed = treeSchema.parse(payload);
    return {
      sha: checkpoint.sha,
      date: checkpoint.date,
      message: checkpoint.message,
      entries: parsed.tree,
      truncated: parsed.truncated,
    };
  });
  const snapshots = buildSnapshots(trees);
  const contributors = buildContributors(commits);
  const reasons: string[] = [];
  if (parsedCommits.length === analysisLimits.history)
    reasons.push(
      `History is sampled from the most recent ${analysisLimits.history} commits.`,
    );
  if (snapshots.some((snapshot) => snapshot.truncated))
    reasons.push(
      `At least one snapshot exceeded the ${analysisLimits.filesPerSnapshot}-file display limit or GitHub returned a truncated tree.`,
    );
  return {
    schemaVersion: "1.0",
    repository: {
      owner: ref.owner,
      name: repository.name,
      fullName: repository.full_name,
      description: repository.description,
      url: repository.html_url,
      defaultBranch: repository.default_branch,
      primaryLanguage: repository.language,
      stars: repository.stargazers_count,
      forks: repository.forks_count,
      updatedAt: repository.updated_at,
    },
    summary: {
      sampledCommits: commits.length,
      contributors: contributors.length,
      filesAtHead: snapshots.at(-1)?.totalFiles ?? 0,
      firstSampledAt: commits[0].date,
      lastSampledAt: commits.at(-1)!.date,
    },
    snapshots,
    contributors,
    milestones: buildMilestones(snapshots),
    coverage: {
      historyLimit: analysisLimits.history,
      snapshotCount: snapshots.length,
      fileLimitPerSnapshot: analysisLimits.filesPerSnapshot,
      partial: reasons.length > 0,
      reasons,
    },
  };
}
