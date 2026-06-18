# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-06-18

### Added

- A dedicated **`isolation`** CI job and a **`test:isolation`** npm script for the cross-account spec.

### Changed

- The cross-account isolation spec is now tagged `@isolation` and excluded from the default run (`npm test` / `npm run test:api` use `--grep-invert "@ratelimit|@isolation"`), so the main suite no longer needs a second-account token. A lapsed `GOREST_TOKEN_SUB` now reddens only the `isolation` job - which is **not** advisory, so a genuine isolation regression still shows red - rather than the main API suite. The default-suite API call budget returns to **367** (the isolation spec's ~17 calls - ~8 MAIN + 9 SUB - now run separately, like the `@ratelimit` burst); the default `npm test` run is **194** tests (202 total minus the 7 `@isolation` and 1 `@ratelimit`).

### Fixed

- Docs: corrected the TEST_PLAN runtime to Node 22 (was stale at `20+`; the README and CI already required 22).

## [2.0.0] - 2026-06-18

Adds cross-account data-isolation coverage and the supporting two-token setup.
This release renames a required environment variable - see the BREAKING note under Changed before upgrading.

### Added

- **Cross-account data-isolation spec** (`tests/api/users/users-isolation.spec.ts`, 7 TCs). Proves GoRest isolates data per account, not per token: a second account's valid token gets `404` on another account's `/users/{id}` (read and all write verbs) and `200 []` on nested lists, with positive controls and post-write integrity re-reads confirming no silent mutation.
- **`authedRequestSub` fixture** and the **`GOREST_TOKEN_SUB`** env var - a lazily-checked second-account token used only by the isolation spec; the rest of the suite runs without it.
- **ESLint** (flat config) **+ Prettier** with `lint` / `format` scripts and a tokenless CI `lint` job.
- **GitHub Pages** publishing of the latest `master` run's HTML report to a live URL.
- **CI per-run summary** (passed / failed / flaky / skipped table) on the run Summary tab.
- **Dependabot** weekly updates (GitHub Actions + npm).
- **ISC LICENSE** and a **Mermaid architecture diagram** in the README.

### Changed

- **BREAKING:** renamed the required env var `GOREST_TOKEN` -> `GOREST_TOKEN_MAIN`. Existing setups must update both the local `.env` and the GitHub Actions repository secret, or the suite fails at load with `GOREST_TOKEN_MAIN is not set`. To migrate: rename `GOREST_TOKEN=` to `GOREST_TOKEN_MAIN=` in `.env`, and rename the `GOREST_TOKEN` repository secret to `GOREST_TOKEN_MAIN` (Settings -> Secrets and variables -> Actions).
- Corrected documentation throughout: isolation is per-account, not per-token (new gotcha catalogued; decisions #2/#4 reworded).
- Coverage 195 -> 202 TCs; API call budget 367 -> 384 (the second account's calls draw on a separate 300/min bucket).
- CI hardened: a static-checks job (lint + format + typecheck) runs on every event; the token-dependent API suite is skipped on secret-less Dependabot/fork PRs (lint + typecheck still run there).

### Fixed

- Flake hardening: a 15s per-request timeout on the authed context so a stalled setup request fails fast and the retry recovers.

### Security

- Enabled `master` branch protection (repository setting, not code): force-push + deletion protection, with `Static checks (lint, format, typecheck)` as a required status check.

## [1.0.0] - 2026-06-17

Initial release - the complete GoRest API test framework.

### Added

- **195 test cases** across the four standard resources (CRUD, validation, security): Users, Posts, Comments, Todos; plus a zod schema-validation demonstration on Users and three GoRest-specific sandbox specs (`?force_status`, `?delay` with a BVA on the 5 s cap, and rate-limit `429` enforcement).
- **Service-wrapper architecture** (`services/*Service.ts`) - endpoint paths and HTTP verbs encapsulated; specs never touch raw paths.
- **Worker-scoped `authedRequest` fixture** injecting the Bearer token once per worker; parent-resource helpers for nested-resource setup.
- **GitHub Actions CI** (API suite + advisory rate-limit burst) and project documentation: README, TEST_PLAN, and an empirically-built gotcha catalogue in `tests/api/CLAUDE.md`.

[2.1.0]: https://github.com/LyuboPetrov94/gorest-api-tests/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/LyuboPetrov94/gorest-api-tests/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/LyuboPetrov94/gorest-api-tests/releases/tag/v1.0.0
