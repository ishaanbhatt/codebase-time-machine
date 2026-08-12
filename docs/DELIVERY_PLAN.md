# Delivery Plan

This plan keeps Codebase Time Machine visually memorable without turning the MVP into a distributed data platform. Each phase has an evidence-based exit gate.

## Product promise

A visitor can understand the project from a zero-network fictional demo, then submit a public GitHub repository and explore a clearly bounded structural history. Every insight is deterministic and every incomplete sample is labeled.

## MVP scope

### Included

- Beautiful responsive landing and explorer experience
- Accessible static demo with five fictional checkpoints
- Public GitHub repository input
- At most 60 recent commits, five recursive trees, and 1,500 displayed files per tree
- Timeline playback and direct checkpoint selection
- Directory/file visualization, sampled contributors, and explainable milestones
- Upstash-backed production rate limiting and 15-minute analysis caching
- Fixed GitHub API adapter with validation and timeouts
- Honest partial-coverage states and recoverable error UX
- Automated lint, type, unit, integration, and production-build gates
- Vercel deployment and open-source project documentation

### Excluded

- Private repositories, OAuth, accounts, or saved projects
- Full-history guarantees
- Source execution, repository cloning, or archive downloads
- AI-generated summaries
- AST and dependency graphs
- Background queues, durable workflows, or a database
- Multiple Git hosting providers

## Phase 1 — Product foundation

**Outcome:** The product communicates its purpose immediately and works without external services.

- Establish the visual system, responsive shell, metadata, and security headers.
- Build the fictional static demo from deterministic checked-in data.
- Add timeline controls, structural visualization, milestones, contributors, and reduced-motion behavior.
- Make the primary value understandable before exposing implementation detail.

**Exit gate**

- The landing experience renders with no GitHub or Upstash credentials.
- Keyboard navigation, visible focus, reduced motion, empty states, and mobile layouts are verified.
- The demo is clearly labeled fictional and never presented as a live repository.

## Phase 2 — Bounded live analysis

**Outcome:** A valid public GitHub repository produces a useful, reproducible sampled story.

- Validate repository identifiers and request bodies.
- Fetch only the fixed GitHub endpoint shapes documented in the architecture.
- Enforce 60-commit, five-tree, and 1,500-file boundaries.
- Generate contributors, change scores, and milestones deterministically.
- Surface history, tree, and display truncation in the result and UI.

**Exit gate**

- Fixture tests prove deterministic ordering and derived results.
- Integration tests cover valid input, invalid hosts/paths, missing/private repositories, GitHub quota, timeout, malformed upstream data, and truncated trees.
- No user input can select an arbitrary network host or execute repository content.

## Phase 3 — Production robustness

**Outcome:** The public endpoint has cost and abuse controls appropriate for a Vercel showcase.

- Apply a distributed five-per-15-minute sliding window.
- Cache completed analyses for 15 minutes by normalized repository name.
- Fail closed in production when Upstash is missing or unavailable.
- Return stable errors, cache diagnostics, rate-limit headers, and retry timing.
- Confirm credentials remain server-side and logs contain no raw secrets or IP addresses.

**Exit gate**

- Tests prove the allowed and blocked rate-limit paths, local fallback, production fail-closed behavior, and cache hit/miss behavior.
- A cache hit avoids GitHub requests but still consumes a client attempt.
- Payload caps, upstream timeouts, CSP, framing protection, and trusted canonical-origin behavior are verified.

## Phase 4 — Release quality

**Outcome:** The repository and deployment are credible open-source portfolio artifacts.

- Run lint, type checking, tests, formatting, and the production build in CI.
- Complete the README, architecture, security policy, contribution guide, code of conduct, and Apache 2.0 license.
- Perform browser QA on desktop and mobile, including slow/error/partial states.
- Test the Vercel deployment with real Upstash and GitHub quota behavior.
- Capture polished product imagery only after the deployed UI is final.

**Exit gate**

- `npm run check` and `npm run format:check` pass locally and in CI.
- The deployed static demo works independently of GitHub.
- One representative public repository succeeds; invalid input, a sixth analysis, and disabled Upstash fail as documented.
- Public copy never describes the sample as a complete history or heuristics as author intent.

## Phase 5 — Post-launch iteration

Only prioritize work supported by observed usage, issue reports, or measured bottlenecks.

Potential follow-ups:

- Shareable immutable reports keyed by captured commit SHA
- Durable jobs for repositories that demonstrably exceed synchronous limits
- Additional explainable heuristics with fixture evidence
- More scalable browser rendering through aggregation or virtualization
- Opt-in OAuth for private repositories with a separate privacy and threat-model review
- Optional grounded narratives that cite deterministic findings

Each follow-up requires its own scope, failure model, cost controls, and completion gate. None is part of the MVP promise.

## Release checklist

- [x] Static demo builds without external credentials and is labeled fictional.
- [x] Public repository analysis respects all documented caps in tests and a live API smoke test.
- [x] Partial coverage is present in the API contract and explorer disclosure.
- [ ] Rate limit and cache use production Upstash.
- [x] GitHub and Upstash credentials remain server-only by construction and configuration.
- [x] Error states provide a safe next action without leaking upstream data.
- [ ] Keyboard, screen-reader labels, contrast, mobile layout, and reduced motion are checked.
- [x] Unit, integration, formatting, lint, type, and build checks pass.
- [x] Vercel environment and canonical URL are verified.
- [x] Documentation matches the locally verified implementation.

Unchecked items require production Upstash plus a final keyboard, screen-reader, and contrast QA pass. The Vercel deployment and canonical origin have been verified independently of those remaining gates.
