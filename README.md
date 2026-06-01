# GoRest API Tests

API testing framework for the [GoRest](https://gorest.co.in/) sandbox REST API, built with [Playwright](https://playwright.dev/) and TypeScript. Continuation of patterns developed in a prior UI + API testing framework, applied to a Bearer-token-authenticated API with per-token data isolation.

## Status

Scaffolding complete; first resource (Users) forthcoming. This README expands as specs land.

## Why GoRest

GoRest is unusually well-suited for portfolio-grade API testing demonstrations:

- **Per-token data isolation** - records created by one access token are invisible to others, so tests never collide with other consumers of the public sandbox
- **Real Bearer-token authentication** - enforced server-side, properly returns 401/403, suitable for genuine auth-gate negative tests
- **Built-in error and latency simulation** - `?force_status=N` and `?delay=N` query parameters specifically designed for testing error-path handling
- **Testable rate limiting** - 90 requests/min default with `X-RateLimit-*` response headers, supports demonstrating 429 handling
- **24-hour auto-reseed** - predictable state cycle, leaked records self-clean

## Tech Stack

- **Playwright** v1.60 - test runner, API request context
- **TypeScript** 6.x - strict mode
- **zod** v4.x - runtime response schema validation (used in one demonstration spec)
- **dotenv** - loads `GOREST_TOKEN` from `.env` at config-load time
- **Node.js** 20+

## What This Demonstrates

(Sections marked *planned* are part of the design but not yet implemented.)

- **Service-wrapper pattern** - endpoints and HTTP verbs encapsulated in `services/<Resource>Service.ts`; specs never touch raw paths
- **Worker-scoped authenticated request fixture** - `authedRequest` injects the Bearer token once per worker; tests reuse the context
- **ISTQB test design** - equivalence partitioning, 3-point boundary value analysis, decision tables, state-transition coverage *(planned: applied per resource)*
- **Runtime schema validation** with strict-mode `zod` - *(planned: one demonstration spec on `POST /users`)*
- **Rate-limit behavior verification** - *(planned: dedicated spec asserting 429 + `X-RateLimit-Remaining` header behavior)*
- **Force-error and delay simulation handling** - *(planned: dedicated specs using `?force_status` and `?delay` query params)*
- **Per-subtree documentation** - `tests/api/CLAUDE.md` carries API-specific conventions, decisions, and discovered gotchas

## Project Structure

```
gorest-api-tests/
├── tests/
│   └── api/
│       └── CLAUDE.md          # API conventions, the 5 locked decisions, gotcha catalogue
├── services/                  # Service wrappers (one class per resource) - populated per spec
├── schemas/                   # zod response-shape schemas (one demonstration on Users)
├── fixtures/
│   └── index.ts               # authedRequest (worker-scoped Bearer-token APIRequestContext)
├── helpers/
│   └── data.ts                # randomEmail, randomName, randomString
├── playwright.config.ts       # Single `api` project, baseURL https://gorest.co.in/public/v2
├── tsconfig.json
├── .env.example               # Template - copy to .env and fill GOREST_TOKEN
├── .gitignore                 # .env, node_modules, test-results, playwright-report
├── CLAUDE.md                  # Project conventions (root)
└── README.md                  # This file
```

## Getting Started

### Prerequisites

- Node.js 20 or higher
- npm
- A GoRest access token - see step 2 below

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Get a GoRest access token
#    Sign in at https://gorest.co.in/ with GitHub / Google / Microsoft.
#    Generate a personal access token from the account dashboard.

# 3. Configure your token
cp .env.example .env
#    Edit .env and set GOREST_TOKEN=<your-token>
#    .env is gitignored - never commit your actual token.
```

### Verify the setup

```bash
npm run typecheck    # tsc --noEmit; should report no errors
```

## Running Tests

```bash
# All tests
npm test

# API specs only (single `api` project, no browser needed)
npm run test:api

# Specific resource
npx playwright test tests/api/users

# Debug mode
npm run test:debug

# HTML report after a run
npm run report
```

### Parallelism notes

GoRest's default token rate limit is **90 requests/minute**. `playwright.config.ts` defaults to 2 workers locally and 1 on CI to stay under the limit. If your token has a raised rate limit, increase `workers` in the config. If you hit unexpected 429s, lower it.

## Architecture

### Service Wrappers

Each GoRest resource gets a corresponding class in `services/` (the API equivalent of a Page Object Model). Services own endpoint paths and HTTP verbs; specs only see methods. Conventions and design rules live in [`tests/api/CLAUDE.md`](tests/api/CLAUDE.md).

### Fixtures

`fixtures/index.ts` exposes:

- **`authedRequest`** - worker-scoped `APIRequestContext` pre-loaded with `Authorization: Bearer ${GOREST_TOKEN}`. Token is loaded from `.env` at config-load time; fixture fails loudly at module load if it's missing.

### Helpers

- **`helpers/data.ts`** - randomized data generators (`randomEmail`, `randomName`, `randomString`). Added per resource as concrete needs appear; no speculative helpers.

### Schemas (planned)

`schemas/UserSchemas.ts` will hold zod schemas for `POST /users` response validation - one demonstration spec, not retrofitted across all assertions. Strict-mode (`.strict()`) catches "server added a field" regressions that `toMatchObject` cannot.

## Test Design Techniques

Tests apply ISTQB techniques:

- **Equivalence Partitioning** - one test per valid/invalid input class
- **Boundary Value Analysis (3-point)** - below, at, and above limits; all three points kept even when "at" and "above" produce identical outcomes (boundary shape, not just outcome diversity)
- **Decision Table** - multi-input combinations mapped to expected outcomes
- **State Transition** - multi-step flows covering valid and invalid transitions

## Documentation Map

| File | What's in it |
|------|--------------|
| [`README.md`](README.md) | This file - overview, scope, getting started |
| [`CLAUDE.md`](CLAUDE.md) | Project-wide conventions and the inspect-and-approve workflow rules |
| [`tests/api/CLAUDE.md`](tests/api/CLAUDE.md) | API conventions, the 5 locked project-specific decisions, schema-validation discipline, gotcha catalogue (fills empirically) |
