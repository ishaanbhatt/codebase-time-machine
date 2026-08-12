# Codebase Time Machine

**Watch a public GitHub repository evolve.**

Codebase Time Machine turns a bounded sample of Git history into an interactive story: structural checkpoints, file-growth milestones, contributor activity, and change hotspots. The landing experience includes a fictional static demo, so visitors can understand the product without spending GitHub API quota.

The project is intentionally smaller than a full Git mining platform. It analyzes public repositories synchronously, uses deterministic rules rather than ungrounded AI summaries, and labels incomplete coverage clearly.

## What it shows

- Up to 60 recent commits from a public repository
- Up to five evenly spaced repository-tree checkpoints
- File and directory growth across those checkpoints
- Contributors within the sampled commit window
- Explainable milestones backed by file-count and directory evidence
- Honest coverage notes when history or trees are truncated
- A built-in fictional demo that requires no network request

## Technical highlights

- Next.js App Router, React, and TypeScript
- A pure deterministic analysis layer with stable sorting
- Strict request and GitHub-response validation with Zod
- Fixed GitHub REST endpoints—no cloning, archive downloads, or user-controlled fetch targets
- Upstash Redis for distributed production rate limiting and a 15-minute analysis cache
- Security headers, bounded payloads, upstream timeouts, and fail-closed production controls
- A Vercel-oriented serverless architecture with no local persistence assumptions

See [Architecture](docs/ARCHITECTURE.md) for the request flow and trust boundaries, and [Delivery plan](docs/DELIVERY_PLAN.md) for the release gates.

## Run locally

### Prerequisites

- Node.js 22 or newer
- npm 11 or newer

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Upstash is optional during local development. Without it, the app uses an in-memory limiter that resets when the process restarts. A GitHub token is also optional locally, but unauthenticated GitHub API quotas are much lower.

Before opening a pull request, run:

```bash
npm run check
npm run format:check
```

## Environment variables

| Variable                   | Production                      | Purpose                                                                                        |
| -------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `UPSTASH_REDIS_REST_URL`   | Required                        | Distributed rate-limit and cache endpoint                                                      |
| `UPSTASH_REDIS_REST_TOKEN` | Required                        | Server-only credential for Upstash                                                             |
| `GITHUB_TOKEN`             | Recommended                     | Raises GitHub API quota; keep server-only and grant only the access needed for public metadata |
| `RATE_LIMIT_SALT`          | Recommended                     | Pseudonymizes client addresses in limiter keys; use a long random secret                       |
| `SITE_URL`                 | Required for canonical metadata | Trusted public origin, such as `https://your-project.vercel.app`                               |

Never expose these values through `NEXT_PUBLIC_` variables. Do not commit `.env.local`.

## Deploy on Vercel

1. Push the repository to GitHub and import it into Vercel.
2. Create an Upstash Redis integration from the Vercel Marketplace, or supply an existing Upstash REST URL and token.
3. Add the production environment variables from the table above. Set `SITE_URL` to the canonical HTTPS deployment origin.
4. Use Node.js 22 for the project and keep the repository root as the Vercel root directory.
5. Deploy, then confirm the static demo and a public-repository analysis both work.
6. Verify a sixth uncached analysis from one client within 15 minutes receives `429` with `Retry-After`, and verify removing the Upstash variables causes production analysis to fail closed.

Vercel builds with `npm run build`. The analysis route uses the Node.js runtime, is dynamic, and has a 20-second maximum duration declared in the application.

## API

`POST /api/analyze`

```json
{
  "repository": "vercel/next.js"
}
```

The `repository` value may be an `owner/repository` pair or a clean HTTPS `github.com/owner/repository` URL. Other hosts, URL credentials, query strings, fragments, and extra path segments are rejected.

Every request consumes one of five analysis attempts per 15-minute client window, including cache hits and invalid repository inputs after the content-type check. Successful responses include coverage metadata and `X-Analysis-Cache: HIT` or `MISS` when the distributed store is available.

## Known limitations

- Only public GitHub repositories are supported.
- Analysis covers at most the 60 most recent commits, not the complete history.
- At most five recursive trees are fetched. GitHub may truncate a large tree independently of the app's limits.
- Only the first 1,500 file paths in deterministic alphabetical order are visualized per checkpoint.
- Contributor counts describe only the sampled commit window.
- Milestones are structural heuristics, not claims about author intent or architectural quality.
- The cache is keyed by normalized repository name for 15 minutes, not by commit SHA, so a newly pushed commit may not appear until the cache expires.
- Analysis is synchronous and bounded by GitHub latency and the Vercel function duration. Very large or slow repositories can fail cleanly rather than continue in the background.
- Private repositories, AST/dependency analysis, arbitrary Git hosts, AI narratives, and durable background jobs are outside the MVP.

## Contributing and security

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
