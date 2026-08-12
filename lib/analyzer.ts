import type {
  Contributor,
  FileNode,
  Milestone,
  RepositorySnapshot,
} from "@/lib/contracts";

export type CommitInput = {
  sha: string;
  date: string;
  message: string;
  author: string;
  avatarUrl?: string;
  treeSha: string;
};
export type TreeInput = {
  sha: string;
  date: string;
  message: string;
  entries: Array<{ path: string; size?: number; type: string }>;
  truncated: boolean;
};

const FILE_LIMIT = 1500;
function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function extensionFor(path: string) {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "other";
}

export function normalizeFiles(entries: TreeInput["entries"]): FileNode[] {
  return entries
    .filter((entry) => entry.type === "blob")
    .map((entry) => {
      const parts = entry.path.split("/");
      const name = parts.pop() ?? entry.path;
      return {
        path: entry.path,
        name,
        directory: parts.join("/") || "root",
        extension: extensionFor(entry.path),
        size: Math.max(0, entry.size ?? 0),
        changeScore: 0,
      };
    })
    .sort((a, b) => compareText(a.path, b.path))
    .slice(0, FILE_LIMIT);
}

export function buildSnapshots(trees: TreeInput[]): RepositorySnapshot[] {
  const normalized = [...trees].sort(
    (a, b) => compareText(a.date, b.date) || compareText(a.sha, b.sha),
  );
  const presence = new Map<string, number>();
  const fileSets = normalized.map(
    (tree) => new Set(normalizeFiles(tree.entries).map((file) => file.path)),
  );
  for (let index = 1; index < fileSets.length; index += 1) {
    const paths = new Set([...fileSets[index - 1], ...fileSets[index]]);
    for (const path of paths)
      if (fileSets[index - 1].has(path) !== fileSets[index].has(path))
        presence.set(path, (presence.get(path) ?? 0) + 1);
  }
  return normalized.map((tree, index) => {
    const files = normalizeFiles(tree.entries).map((file) => ({
      ...file,
      changeScore: presence.get(file.path) ?? 0,
    }));
    const totalFiles = tree.entries.filter(
      (entry) => entry.type === "blob",
    ).length;
    return {
      sha: tree.sha,
      date: tree.date,
      label:
        index === 0
          ? "Starting point"
          : index === normalized.length - 1
            ? "Current shape"
            : `Checkpoint ${index + 1}`,
      files,
      totalFiles,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      truncated: tree.truncated || totalFiles > FILE_LIMIT,
    };
  });
}

export function buildContributors(commits: CommitInput[]): Contributor[] {
  const totals = new Map<string, Contributor>();
  for (const commit of commits) {
    const key = commit.author.trim() || "Unknown contributor";
    const current = totals.get(key);
    totals.set(key, {
      name: key,
      avatarUrl: current?.avatarUrl ?? commit.avatarUrl,
      commits: (current?.commits ?? 0) + 1,
    });
  }
  return [...totals.values()].sort(
    (a, b) => b.commits - a.commits || compareText(a.name, b.name),
  );
}

export function buildMilestones(snapshots: RepositorySnapshot[]): Milestone[] {
  return snapshots.slice(1).map((snapshot, index) => {
    const previous = snapshots[index];
    const delta = snapshot.totalFiles - previous.totalFiles;
    const previousDirs = new Set(
      previous.files.map((file) => file.directory.split("/")[0]),
    );
    const newDirs = [
      ...new Set(snapshot.files.map((file) => file.directory.split("/")[0])),
    ]
      .filter((directory) => !previousDirs.has(directory))
      .slice(0, 3);
    return {
      sha: snapshot.sha,
      date: snapshot.date,
      title: newDirs.length
        ? `${newDirs.join(", ")} ${newDirs.length === 1 ? "appears" : "appear"}`
        : `The repository ${delta >= 0 ? "grew" : "contracted"}`,
      explanation: newDirs.length
        ? `New top-level areas became visible while the repository moved from ${previous.totalFiles} to ${snapshot.totalFiles} files.`
        : `The sampled structure moved from ${previous.totalFiles} to ${snapshot.totalFiles} files.`,
      evidence: `${Math.abs(delta)} file${Math.abs(delta) === 1 ? "" : "s"} ${delta >= 0 ? "added net" : "removed net"} between sampled checkpoints`,
    };
  });
}

export const analysisLimits = {
  history: 60,
  snapshots: 5,
  filesPerSnapshot: FILE_LIMIT,
} as const;
