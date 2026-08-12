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
const repoSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable(),
  html_url: z.string().url(),
  default_branch: z.string(),
  language: z.string().nullable(),
  stargazers_count: z.number(),
  forks_count: z.number(),
  updated_at: z.string(),
  private: z.boolean(),
});
const commitSchema = z.object({
  sha: z.string(),
  html_url: z.string().url(),
  commit: z.object({
    message: z.string(),
    author: z.object({ name: z.string(), date: z.string() }).nullable(),
    committer: z.object({ name: z.string(), date: z.string() }).nullable(),
    tree: z.object({ sha: z.string() }),
  }),
  author: z
    .object({ login: z.string(), avatar_url: z.string().url() })
    .nullable(),
});
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string(),
      type: z.string(),
      size: z.number().optional(),
    }),
  ),
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

async function githubJson(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      headers: githubHeaders(),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
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
  if (!response.ok) {
    if (response.status === 404)
      throw new GitHubError(
        "REPOSITORY_NOT_FOUND",
        "This public repository could not be found.",
        404,
      );
    if (response.status === 403 || response.status === 429) {
      const resetAt = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      const retryAfter =
        Number(response.headers.get("retry-after")) ||
        (Number.isFinite(resetAt)
          ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
          : 60);
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
  return response.json();
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
  const owner = encodeURIComponent(ref.owner);
  const repo = encodeURIComponent(ref.repo);
  const [repoPayload, commitPayload] = await Promise.all([
    githubJson(`/repos/${owner}/${repo}`),
    githubJson(
      `/repos/${owner}/${repo}/commits?per_page=${analysisLimits.history}`,
    ),
  ]);
  const repository = repoSchema.parse(repoPayload);
  if (repository.private)
    throw new GitHubError(
      "PRIVATE_REPOSITORY",
      "Only public repositories are supported.",
      403,
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
  const treePayloads = await Promise.all(
    checkpoints.map((commit) =>
      githubJson(
        `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(commit.treeSha)}?recursive=1`,
      ),
    ),
  );
  const trees: TreeInput[] = treePayloads.map((payload, index) => {
    const parsed = treeSchema.parse(payload);
    return {
      sha: checkpoints[index].sha,
      date: checkpoints[index].date,
      message: checkpoints[index].message,
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
