# Security Policy

## Supported versions

Codebase Time Machine is currently pre-1.0. Security fixes are applied to the latest code on the default branch and the latest deployed release.

| Version                         | Supported |
| ------------------------------- | --------- |
| Latest `0.1.x` / default branch | Yes       |
| Older snapshots                 | No        |

## Report a vulnerability

Please do not disclose a suspected vulnerability in a public issue, discussion, pull request, or social post.

Use the repository's **Security** tab to submit a private vulnerability report. Include:

- The affected route, component, or commit
- A concise description of the impact
- Reproduction steps or a minimal proof of concept
- Any relevant deployment assumptions
- A suggested mitigation, if known

If private vulnerability reporting is not enabled, contact the repository owner privately through the contact method listed on their GitHub profile and ask for a secure reporting channel. Do not send secrets or exploit details in that first message.

The maintainers will aim to acknowledge complete reports within three working days. This is a best-effort open-source target, not a service-level agreement. Please allow time to investigate and release a fix before public disclosure.

## Security model

The application:

- Accepts only public GitHub `owner/repository` identifiers or clean HTTPS GitHub repository URLs
- Constructs requests to a fixed `api.github.com` origin
- Does not clone repositories, download archives, execute repository code, or accept arbitrary fetch destinations
- Validates request bodies and upstream GitHub responses
- Limits requests to 1 KiB and upstream calls to an 8-second timeout
- Caps analysis at 60 commits, five trees, and 1,500 displayed files per tree
- Requires Upstash-backed distributed rate limiting and caching in production
- Pseudonymizes client addresses for rate-limit keys
- Keeps GitHub and Upstash credentials server-side
- Emits restrictive application-wide security headers

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed trust boundaries and known residual risks.

## Deployment responsibilities

Operators are responsible for:

- Supplying production Upstash credentials and a strong `RATE_LIMIT_SALT`
- Keeping the GitHub credential scoped to the minimum required public-read access
- Rotating credentials after suspected exposure
- Setting `SITE_URL` from trusted configuration rather than request host headers
- Reviewing Vercel and Upstash logs without enabling sensitive request-header logging
- Monitoring GitHub and Upstash quotas and unexpected analysis traffic
- Updating dependencies and redeploying supported security fixes

Production analysis intentionally fails closed if the distributed limiter is unavailable or unconfigured.

## Out of scope

Reports about a repository's code, GitHub availability, GitHub's own API, social engineering, or volumetric attacks requiring internet-scale capacity are outside this project's direct security boundary. Responsible reports about bypassing the app's validation, limits, caching, headers, or fixed-host protections remain in scope.
