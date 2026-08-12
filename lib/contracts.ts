import { z } from "zod";

export const analyzeRequestSchema = z
  .object({ repository: z.string().trim().min(1).max(200) })
  .strict();

const fileNodeSchema = z.object({
  path: z.string().max(240),
  name: z.string().max(240),
  directory: z.string().max(240),
  extension: z.string().max(32),
  size: z.number().nonnegative().finite(),
  changeScore: z.number().int().nonnegative(),
});
export type FileNode = z.infer<typeof fileNodeSchema>;
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

export const repositoryAnalysisSchema: z.ZodType<RepositoryAnalysis> = z.object(
  {
    schemaVersion: z.literal("1.0"),
    repository: z.object({
      owner: z.string().max(100),
      name: z.string().max(100),
      fullName: z.string().max(201),
      description: z.string().max(500).nullable(),
      url: z.string().url().max(500),
      defaultBranch: z.string().max(240),
      primaryLanguage: z.string().max(100).nullable(),
      stars: z.number().int().nonnegative(),
      forks: z.number().int().nonnegative(),
      updatedAt: z.string().max(50),
    }),
    summary: z.object({
      sampledCommits: z.number().int().min(1).max(60),
      contributors: z.number().int().nonnegative().max(60),
      filesAtHead: z.number().int().nonnegative(),
      firstSampledAt: z.string().max(50),
      lastSampledAt: z.string().max(50),
    }),
    snapshots: z
      .array(
        z.object({
          sha: z.string().max(100),
          date: z.string().max(50),
          label: z.string().max(50),
          files: z.array(fileNodeSchema).max(1500),
          totalFiles: z.number().int().nonnegative(),
          totalBytes: z.number().nonnegative().finite(),
          truncated: z.boolean(),
        }),
      )
      .min(1)
      .max(5),
    contributors: z
      .array(
        z.object({
          name: z.string().max(200),
          avatarUrl: z.string().url().max(500).optional(),
          commits: z.number().int().positive().max(60),
        }),
      )
      .max(60),
    milestones: z
      .array(
        z.object({
          sha: z.string().max(100),
          date: z.string().max(50),
          title: z.string().max(300),
          explanation: z.string().max(500),
          evidence: z.string().max(300),
        }),
      )
      .max(4),
    coverage: z.object({
      historyLimit: z.literal(60),
      snapshotCount: z.number().int().min(1).max(5),
      fileLimitPerSnapshot: z.literal(1500),
      partial: z.boolean(),
      reasons: z.array(z.string().max(300)).max(4),
    }),
  },
);
