import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeGitHubRepository } from "@/lib/server/github";

const repository = {
  name: "project",
  full_name: "example/project",
  description: "Fixture repository",
  html_url: "https://github.com/example/project",
  default_branch: "main",
  language: "TypeScript",
  stargazers_count: 12,
  forks_count: 3,
  updated_at: "2026-01-03T00:00:00Z",
  private: false,
};

const commits = Array.from({ length: 3 }, (_, index) => ({
  sha: `commit-${index}`,
  html_url: `https://github.com/example/project/commit/${index}`,
  commit: {
    message: `Change ${index}`,
    author: {
      name: `Author ${index}`,
      date: `2026-01-0${index + 1}T00:00:00Z`,
    },
    committer: {
      name: `Author ${index}`,
      date: `2026-01-0${index + 1}T00:00:00Z`,
    },
    tree: { sha: `tree-${index}` },
  },
  author: null,
}));

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
});

describe("GitHub adapter", () => {
  it("uses only fixed GitHub endpoints and produces bounded snapshots", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requested.push(url);
        if (url === "https://api.github.com/repos/example/project")
          return jsonResponse(repository);
        if (url.includes("/commits?per_page=60")) return jsonResponse(commits);
        const tree = url.match(/tree-(\d)/)?.[1] ?? "0";
        return jsonResponse({
          truncated: false,
          tree: [
            { path: "README.md", type: "blob", size: 100 },
            { path: `src/checkpoint-${tree}.ts`, type: "blob", size: 200 },
          ],
        });
      }),
    );

    const result = await analyzeGitHubRepository({
      owner: "example",
      repo: "project",
    });

    expect(result.repository.fullName).toBe("example/project");
    expect(result.snapshots).toHaveLength(3);
    expect(result.summary.sampledCommits).toBe(3);
    expect(result.coverage.partial).toBe(false);
    expect(requested).toEqual([
      "https://api.github.com/repos/example/project",
      "https://api.github.com/repos/example/project/commits?per_page=60",
      "https://api.github.com/repos/example/project/git/trees/tree-0?recursive=1",
      "https://api.github.com/repos/example/project/git/trees/tree-1?recursive=1",
      "https://api.github.com/repos/example/project/git/trees/tree-2?recursive=1",
    ]);
  });

  it("preserves GitHub tree truncation as explicit partial coverage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/example/project")) return jsonResponse(repository);
        if (url.includes("/commits?")) return jsonResponse([commits[0]]);
        return jsonResponse({
          truncated: true,
          tree: [{ path: "src/index.ts", type: "blob", size: 100 }],
        });
      }),
    );

    const result = await analyzeGitHubRepository({
      owner: "example",
      repo: "project",
    });
    expect(result.coverage.partial).toBe(true);
    expect(result.snapshots[0].truncated).toBe(true);
    expect(result.coverage.reasons[0]).toContain("truncated tree");
  });

  it("maps missing repositories and exhausted GitHub quota to safe errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, { status: 404 })),
    );
    await expect(
      analyzeGitHubRepository({ owner: "missing", repo: "repository" }),
    ).rejects.toMatchObject({
      code: "REPOSITORY_NOT_FOUND",
      status: 404,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {},
          {
            status: 403,
            headers: {
              "content-type": "application/json",
              "retry-after": "45",
            },
          },
        ),
      ),
    );
    await expect(
      analyzeGitHubRepository({ owner: "example", repo: "project" }),
    ).rejects.toMatchObject({
      code: "GITHUB_RATE_LIMITED",
      status: 503,
      retryAfter: 45,
    });
  });

  it("does not include a GitHub authorization header without a token", async () => {
    const headersSeen: HeadersInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        headersSeen.push(init?.headers ?? {});
        const url = String(input);
        if (url.endsWith("/example/project")) return jsonResponse(repository);
        if (url.includes("/commits?")) return jsonResponse([commits[0]]);
        return jsonResponse({ truncated: false, tree: [] });
      }),
    );
    await analyzeGitHubRepository({ owner: "example", repo: "project" });
    expect(JSON.stringify(headersSeen)).not.toContain("Authorization");
  });
});
