# Contributing

Thanks for helping make Codebase Time Machine more useful, understandable, and reliable.

## Before you start

- Search existing issues and pull requests before opening a new one.
- Use an issue to discuss substantial behavior, new data collection, new dependencies, or architecture changes before investing in an implementation.
- Keep changes focused. Avoid unrelated refactors and speculative abstractions.
- For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

You need Node.js 22 or newer and npm 11 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Upstash and a GitHub token are optional locally. The local fallback limiter is intentionally process-local and must never be treated as a production control.

## Making a change

1. Fork the repository and create a focused branch.
2. Add or update tests that demonstrate the behavior.
3. Preserve the product's evidence boundary: sampled or truncated data must remain visibly labeled.
4. Keep deterministic analysis independent of network access, current time, random values, and AI-generated interpretation.
5. Update documentation when limits, environment variables, API behavior, or user-visible claims change.
6. Run the complete local checks.

```bash
npm run check
npm run format:check
```

## Pull request checklist

- The pull request explains the user-visible outcome and why the change is needed.
- Tests cover success, failure, and relevant boundary cases.
- Lint, type checking, tests, formatting, and the production build pass.
- New external calls have fixed destinations, timeouts, validation, and bounded response handling.
- New expensive endpoints have distributed rate limiting in production.
- Secrets, tokens, personal data, and raw IP addresses are not logged or returned.
- Accessibility and reduced-motion behavior are preserved for UI changes.
- Documentation describes new limits or incomplete-coverage behavior honestly.

## Project principles

### Bounded by design

This is a showcase-quality GitHub history explorer, not an exhaustive mining system. Prefer explicit caps and useful partial results over background complexity or unbounded work.

### Deterministic before generative

Core findings must be reproducible from validated inputs. If optional narrative features are proposed later, they must cite the deterministic evidence and remain clearly distinguishable from facts.

### Secure fixed integrations

Do not add arbitrary URL fetching, archive execution, repository cloning in request handlers, or source-code execution. GitHub inputs must resolve through the fixed API boundary documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Small pull requests

Prefer one coherent change that can be reviewed and reverted independently. Match the existing style and remove only code made unused by your change.

## Licensing

Unless explicitly stated otherwise, contributions submitted for inclusion in this project are licensed under the [Apache License 2.0](LICENSE).
