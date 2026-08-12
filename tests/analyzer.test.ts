import { describe, expect, it } from "vitest";

import {
  analysisLimits,
  buildContributors,
  buildMilestones,
  buildSnapshots,
  normalizeFiles,
  type CommitInput,
  type TreeInput,
} from "@/lib/analyzer";

const trees: TreeInput[] = [
  {
    sha: "c3",
    date: "2026-03-01T00:00:00.000Z",
    message: "add docs",
    truncated: false,
    entries: [
      { path: "src/index.ts", size: 12, type: "blob" },
      { path: "docs/guide.md", size: 8, type: "blob" },
      { path: "docs", type: "tree" },
    ],
  },
  {
    sha: "a1",
    date: "2026-01-01T00:00:00.000Z",
    message: "initial",
    truncated: false,
    entries: [{ path: "src/index.ts", size: 10, type: "blob" }],
  },
  {
    sha: "b2",
    date: "2026-02-01T00:00:00.000Z",
    message: "add tests",
    truncated: false,
    entries: [
      { path: "tests/index.test.ts", size: 20, type: "blob" },
      { path: "src/index.ts", size: 11, type: "blob" },
    ],
  },
];

describe("normalizeFiles", () => {
  it("keeps blobs only and returns a stable path order with normalized metadata", () => {
    expect(
      normalizeFiles([
        { path: "z/.env", size: -4, type: "blob" },
        { path: "README", type: "blob" },
        { path: "src/app.TSX", size: 4, type: "blob" },
        { path: "src", type: "tree" },
      ]),
    ).toMatchInlineSnapshot(`
      [
        {
          "changeScore": 0,
          "directory": "root",
          "extension": "other",
          "name": "README",
          "path": "README",
          "size": 0,
        },
        {
          "changeScore": 0,
          "directory": "src",
          "extension": "tsx",
          "name": "app.TSX",
          "path": "src/app.TSX",
          "size": 4,
        },
        {
          "changeScore": 0,
          "directory": "z",
          "extension": "other",
          "name": ".env",
          "path": "z/.env",
          "size": 0,
        },
      ]
    `);
  });

  it("caps files deterministically after sorting", () => {
    const entries = Array.from(
      { length: analysisLimits.filesPerSnapshot + 2 },
      (_, index) => ({
        path: `src/file-${String(analysisLimits.filesPerSnapshot + 1 - index).padStart(4, "0")}.ts`,
        size: 1,
        type: "blob",
      }),
    );

    const files = normalizeFiles(entries);
    expect(files).toHaveLength(analysisLimits.filesPerSnapshot);
    expect(files.map((file) => file.path)).toEqual(
      [...files.map((file) => file.path)].sort((a, b) =>
        a.localeCompare(b, "en"),
      ),
    );
    expect(files.at(-1)?.path).toBe("src/file-1499.ts");
  });
});

describe("buildSnapshots", () => {
  it("sorts checkpoints deterministically and derives labels and presence changes", () => {
    const result = buildSnapshots(trees);
    expect(result.map(({ sha, label }) => ({ sha, label }))).toEqual([
      { sha: "a1", label: "Starting point" },
      { sha: "b2", label: "Checkpoint 2" },
      { sha: "c3", label: "Current shape" },
    ]);
    expect(result[0].files[0]).toMatchObject({
      path: "src/index.ts",
      changeScore: 0,
    });
    expect(
      result[1].files.find((file) => file.path === "tests/index.test.ts")
        ?.changeScore,
    ).toBe(2);
    expect(
      result[2].files.find((file) => file.path === "docs/guide.md")
        ?.changeScore,
    ).toBe(1);
    expect(buildSnapshots([...trees].reverse())).toEqual(result);
  });

  it("uses sha as the stable tie-breaker for equal dates", () => {
    const tied = trees
      .slice(0, 2)
      .map((tree) => ({ ...tree, date: "2026-01-01T00:00:00.000Z" }));
    expect(buildSnapshots(tied).map((snapshot) => snapshot.sha)).toEqual([
      "a1",
      "c3",
    ]);
  });

  it("marks snapshots partial while preserving the uncapped file total", () => {
    const entries = Array.from(
      { length: analysisLimits.filesPerSnapshot + 1 },
      (_, index) => ({
        path: `src/${String(index).padStart(4, "0")}.ts`,
        size: 2,
        type: "blob",
      }),
    );
    const [snapshot] = buildSnapshots([
      { ...trees[0], entries, truncated: false },
    ]);

    expect(snapshot.files).toHaveLength(analysisLimits.filesPerSnapshot);
    expect(snapshot.totalFiles).toBe(analysisLimits.filesPerSnapshot + 1);
    expect(snapshot.totalBytes).toBe(analysisLimits.filesPerSnapshot * 2);
    expect(snapshot.truncated).toBe(true);
  });

  it("propagates an upstream truncated-tree signal even below the local cap", () => {
    const [snapshot] = buildSnapshots([{ ...trees[0], truncated: true }]);
    expect(snapshot.truncated).toBe(true);
  });
});

describe("buildContributors", () => {
  const commit = (author: string, avatarUrl?: string): CommitInput => ({
    sha: `${author}-${avatarUrl ?? "none"}`,
    date: "2026-01-01T00:00:00.000Z",
    message: "change",
    author,
    avatarUrl,
    treeSha: "tree",
  });

  it("counts exact author identities and sorts by count then name", () => {
    const result = buildContributors([
      commit("Zoe"),
      commit("Ada", "https://example.test/ada.png"),
      commit("Zoe", "https://example.test/zoe.png"),
      commit("Bob"),
      commit("  "),
    ]);

    expect(result).toEqual([
      { name: "Zoe", avatarUrl: "https://example.test/zoe.png", commits: 2 },
      { name: "Ada", avatarUrl: "https://example.test/ada.png", commits: 1 },
      { name: "Bob", avatarUrl: undefined, commits: 1 },
      { name: "Unknown contributor", avatarUrl: undefined, commits: 1 },
    ]);
  });

  it("is deterministic when input order changes without changing first-avatar precedence", () => {
    const commits = [
      commit("Ada", "https://example.test/ada.png"),
      commit("Zoe"),
      commit("Ada"),
    ];
    expect(buildContributors([...commits].reverse())).toEqual(
      buildContributors(commits),
    );
  });
});

describe("buildMilestones", () => {
  it("grounds milestones in snapshot deltas and newly visible top-level areas", () => {
    expect(buildMilestones(buildSnapshots(trees))).toEqual([
      {
        sha: "b2",
        date: "2026-02-01T00:00:00.000Z",
        title: "tests appears",
        explanation:
          "New top-level areas became visible while the repository moved from 1 to 2 files.",
        evidence: "1 file added net between sampled checkpoints",
      },
      {
        sha: "c3",
        date: "2026-03-01T00:00:00.000Z",
        title: "docs appears",
        explanation:
          "New top-level areas became visible while the repository moved from 2 to 2 files.",
        evidence: "0 files added net between sampled checkpoints",
      },
    ]);
  });

  it("describes contraction when no new top-level area appears", () => {
    const snapshots = buildSnapshots([
      trees[1],
      { ...trees[2], entries: [], message: "remove files" },
    ]);
    expect(buildMilestones(snapshots)[0]).toMatchObject({
      title: "The repository contracted",
      evidence: "1 file removed net between sampled checkpoints",
    });
  });
});
