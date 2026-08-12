import { z } from "zod";

export const analyzeRequestSchema = z
  .object({ repository: z.string().trim().min(1).max(200) })
  .strict();

export type FileNode = {
  path: string;
  name: string;
  directory: string;
  extension: string;
  size: number;
  changeScore: number;
};
export type RepositorySnapshot = {
  sha: string;
  date: string;
  label: string;
  files: FileNode[];
  totalFiles: number;
  totalBytes: number;
  truncated: boolean;
};
export type Contributor = { name: string; avatarUrl?: string; commits: number };
export type Milestone = {
  sha: string;
  date: string;
  title: string;
  explanation: string;
  evidence: string;
};

export type RepositoryAnalysis = {
  schemaVersion: "1.0";
  repository: {
    owner: string;
    name: string;
    fullName: string;
    description: string | null;
    url: string;
    defaultBranch: string;
    primaryLanguage: string | null;
    stars: number;
    forks: number;
    updatedAt: string;
  };
  summary: {
    sampledCommits: number;
    contributors: number;
    filesAtHead: number;
    firstSampledAt: string;
    lastSampledAt: string;
  };
  snapshots: RepositorySnapshot[];
  contributors: Contributor[];
  milestones: Milestone[];
  coverage: {
    historyLimit: number;
    snapshotCount: number;
    fileLimitPerSnapshot: number;
    partial: boolean;
    reasons: string[];
  };
};

export type ApiError = {
  error: { code: string; message: string; retryAfter?: number };
};
