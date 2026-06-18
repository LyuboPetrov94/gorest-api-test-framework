# Test Plan - GoRest API Tests

| Field | Value |
|-------|-------|
| Plan ID | GOREST-API-TESTPLAN |
| Version | 1.0 |
| Last updated | 2026-06-10 |
| Author | repo owner (github.com/LyuboPetrov94) |
| Status | Complete - all planned tests implemented and green (202 TCs) |

This plan follows the IEEE 829 / ISTQB master-test-plan shape, adapted for a single-maintainer automation project. It cross-references the single sources of truth rather than duplicating them: run commands and the API call budget live in [README.md](README.md); conventions, the locked design decisions, and the discovered-behavior catalogue live in [tests/api/CLAUDE.md](tests/api/CLAUDE.md). Only the live coverage counts (Section 5) are maintained here.

---

## 1. Introduction & Objectives

This is the test plan for an API automation suite targeting the [GoRest](https://gorest.co.in/) v2 sandbox REST API. The project is a portfolio piece: it demonstrates applied API test design (ISTQB techniques), a maintainable automation architecture (service-wrapper + fixtures), and coverage of capabilities a typical CRUD API does not expose - server-side fault injection, latency simulation, and real rate limiting.

Objectives:

- Verify GoRest's documented behavior across CRUD, input validation, and authorization, on every resource in the data model.
- Demonstrate ISTQB test design techniques (equivalence partitioning, boundary value analysis, decision tables, state transition) on a real API.
- Exercise non-functional and failure-path behavior (forced error statuses, slow responses, rate-limit enforcement) deterministically.
- Document every behavior that contradicts the docs or HTTP conventions as a reusable gotcha.

Intended reader: a QA engineer or reviewer assessing the suite's scope, rigor, and structure.

## 2. System Under Test

| Aspect | Detail |
|--------|--------|
| API | GoRest v2 REST API |
| Origin (baseURL) | `https://gorest.co.in` (origin only; services carry the `/public/v2/<resource>` path - see the URL-resolution gotcha in [tests/api/CLAUDE.md](tests/api/CLAUDE.md)) |
| Authentication | Bearer token (`Authorization: Bearer <token>`), account-bound, loaded from `.env` |
| Data isolation | Per-token: records created by one token are invisible to others and to the public seed |
| Resources | Users (root); Posts and Todos (children of Users); Comments (children of Posts) |
| Sandbox features | `?force_status=N` (forced HTTP status), `?delay=N` (response latency, capped 5000ms), rate limiting (300 req/min per token, refilling token bucket) |
| Reseed | Public data auto-reseeds every 24h |

## 3. Scope

### 3.1 In scope

- **Resources:** Users, Posts, Comments, Todos - each across the applicable test types below.
- **Test types:**
  - Functional CRUD (create/read/update/delete happy paths, pagination, state transitions)
  - Input validation (required fields, formats, enums, length bounds, error aggregation)
  - Security / authorization (auth-gate negatives on write verbs and per-id reads)
  - Contract / schema validation (one zod demonstration spec on Users, reused across endpoints)
  - Non-functional sandbox behavior (fault injection, latency, rate limiting)

### 3.2 Out of scope

- **UI testing** - GoRest's only UI is its account dashboard; this is an API-only project.
- **OAuth / login flow** - the token is account-bound; there is no per-test login lifecycle to exercise.
- **Cross-token isolation verification** - would require provisioning a second token; the isolation property is documented where relevant but not actively asserted across token boundaries.
- **Public seed-data assertions** - the seed is shared and would be flaky; tests assert only on records this suite creates.

## 4. Test Approach

- **Test level:** API / integration (HTTP request-response against the live sandbox; no browser).
- **Test types and techniques:**

  | Test type | Primary techniques |
  |-----------|--------------------|
  | CRUD | State transition (resource lifecycle, DELETE idempotency), positive partitions |
  | Validation | Equivalence partitioning, 3-point boundary value analysis (5-point on length bounds), error-aggregation set assertions |
  | Security | Equivalence partitioning - two auth-gate EP classes (no token vs. invalid token) per write verb; parameterised verb loops |
  | Schema | Strict runtime validation (zod), plus a negative-of-schema unit test |
  | Non-functional | Fault injection (`?force_status`), latency BVA (`?delay` cap), rate-limit boundary (concurrent burst to `429`) |

- **Automation architecture:** service-wrapper pattern (endpoints/verbs encapsulated, never in specs), worker-scoped `authedRequest` fixture, parent-setup helpers with cascade-delete cleanup. Design rules are locked in [tests/api/CLAUDE.md](tests/api/CLAUDE.md); a per-pattern showcase with spec links is in the README's [Notable Patterns](README.md#notable-patterns).
- **Probe-first:** each resource is probed against the live API before tests are written, so assertions pin observed behavior rather than assumed behavior.

## 5. Coverage Matrix

### Standard resources

| Resource | CRUD | Validation | Security | Schema | Isolation | Total |
|---|---|---|---|---|---|---|
| Users | ✅ 8 | ✅ 16 | ✅ 11 | ✅ 4 | ✅ 7 | 46 |
| Posts | ✅ 11 | ✅ 19 | ✅ 13 | - | - | 43 |
| Comments | ✅ 11 | ✅ 23 | ✅ 13 | - | - | 47 |
| Todos | ✅ 15 | ✅ 19 | ✅ 13 | - | - | 47 |
| **Subtotal** | **45** | **77** | **50** | **4** | **7** | **183** |

The **Isolation** column is `users-isolation.spec.ts` (cross-account data isolation). Users is the single carrier - token scoping is a platform-wide property, not per-resource logic - and it requires a second account's token (`GOREST_TOKEN_SUB`).

### Sandbox bonus specs (GoRest-specific capabilities)

These exercise sandbox features that do not fit the standard CRUD/validation/security/schema lens.

| Spec | Coverage | TCs |
|---|---|---|
| `?force_status=N` error simulation | ✅ done | 10 |
| `?delay=N` slow-response handling | ✅ done | 6 |
| Rate-limit headers + 429 behavior | ✅ done | 3 |
| **Subtotal** | | **19** |

**Grand total: 202 TCs.** For per-TC detail, read the spec files directly; for the per-spec HTTP call budget, see the README's [API Call Budget](README.md#api-call-budget).

## 6. Test Environment

| Component | Value |
|-----------|-------|
| Runner | Playwright v1.60 (API request context) |
| Language | TypeScript 6.x (strict) |
| Schema validation | zod v4.x |
| Config loading | dotenv (loads `GOREST_TOKEN_MAIN` + `GOREST_TOKEN_SUB` at config-load time) |
| Runtime | Node.js 22+ |
| Token | `GOREST_TOKEN_MAIN` (main account) + `GOREST_TOKEN_SUB` (second account, isolation spec only) in `.env` (gitignored); see README [Getting Started](README.md#getting-started) |
| Parallelism | `fullyParallel: true`; `workers: 2` local / `1` on CI - tuned to stay under the 300 req/min token budget |
| Retries | `retries: 1` (absorbs transient network flakiness) |

**Isolated specs (own runs / CI jobs):** two specs are tagged out of the default run (`--grep-invert "@ratelimit|@isolation"`) and run on their own. (1) The rate-limit burst (`rate-limit.spec.ts` TC03, `@ratelimit`) via `npm run test:ratelimit`, so its ~400-request burst does not starve other authed specs' minute budget. (2) The cross-account isolation spec (`users-isolation.spec.ts`, `@isolation`) via `npm run test:isolation`, because it needs a second account's token (`GOREST_TOKEN_SUB`) and gets its own CI job so a lapsed second token reddens only that job. See README [Running Tests](README.md#running-tests).

## 7. Entry & Exit Criteria

**Entry criteria (before a spec is written or run):**

- `GOREST_TOKEN_MAIN` configured in `.env` (plus `GOREST_TOKEN_SUB` for the cross-account isolation spec).
- `npm run typecheck` passes (no TypeScript errors).
- The target endpoint has been probed and its observed behavior recorded.
- For a new resource: the test-case list is proposed and approved (inspect-and-approve workflow, see [CLAUDE.md](CLAUDE.md)).

**Exit criteria / Definition of Done:**

- Every test case in the spec passes on a real test run - **"written is not done."** A TC is marked ✅ only after a green run, never on authoring alone.
- Implementation behavior is verified end-to-end, not inferred from a green report (e.g. cleanup DELETEs are confirmed, not assumed).
- Any newly discovered behavior is codified as a gotcha in [tests/api/CLAUDE.md](tests/api/CLAUDE.md).
- Coverage docs are updated in lockstep: this matrix, the backlog, and the README budget table.

## 8. Risks & Assumptions

| Risk / Assumption | Impact | Mitigation |
|-------------------|--------|------------|
| Shared public sandbox | Other consumers' data could collide with assertions | Per-token isolation; tests assert only on records they create |
| Per-token rate budget (300/min) | Heavy or bursty runs could hit `429` | `workers` tuned under the limit; the deliberate burst is tagged `@ratelimit` and isolated |
| 24h auto-reseed | Created records eventually disappear | Acts as a safety net for any leaked records; tests do not depend on long-lived state |
| Transient network / server latency | A stalled request can time out a setup hook (observed: a `comments-security` `beforeAll` 30s timeout) | `retries: 1` absorbs one-off flakes; a repeat on a cold run would warrant a tighter per-request timeout |
| Token-bound auth model | No login lifecycle, no second identity | Cross-token isolation and OAuth are explicitly out of scope (Section 3.2) |

## 9. Test Deliverables

- **Spec files** - 16 specs under `tests/api/<resource>/` (4 Users, 3 each for Posts/Comments/Todos, 3 sandbox).
- **Service wrappers** - 5 classes in `services/` (one per resource + `SandboxService`).
- **Schemas** - `schemas/UserSchemas.ts` (the zod demonstration).
- **Fixtures & helpers** - `fixtures/index.ts` (`authedRequest`); `helpers/` (data generators + parent-setup closures).
- **Execution report** - Playwright HTML report (`playwright-report/`, gitignored).
- **Gotcha catalogue** - empirically-built discovered-behavior log in [tests/api/CLAUDE.md](tests/api/CLAUDE.md).
- **Planning docs** - this test plan and [README.md](README.md).

## 10. Defects & Findings

There is no separate defect tracker: the system under test is a public sandbox, so the relevant output is documented *behavior*, not raised bugs. Every behavior that diverges from the docs or from HTTP conventions (for example: parent-not-found returning `422` not `404`; anonymous per-id reads returning `404` via isolation; `due_on` silently coerced to `null`; rate limiting as a refilling bucket, not a fixed window) is recorded as a gotcha in [tests/api/CLAUDE.md](tests/api/CLAUDE.md). Each gotcha carries its probe date and its test-design implication, so the catalogue doubles as the findings log.

## 11. Execution & Reporting

- **Run commands:** see README [Running Tests](README.md#running-tests). The default run (`npm test` / `npm run test:api`) excludes the `@ratelimit` burst; run that in isolation with `npm run test:ratelimit`.
- **Retries:** `retries: 1`; artifacts (trace/screenshot/video) use `*-on-failure` semantics, retained only when the final outcome is failed.
- **Reporting:** Playwright HTML reporter; open with `npm run report`.
- **Cost accounting:** the per-spec HTTP call budget (and the per-token vs. anonymous split) is maintained in the README [API Call Budget](README.md#api-call-budget).

---

## Appendix: Legend & Conventions

**Legend:** ✅ done · 🟡 partial · 🔲 not started · - not applicable

**Conventions:**

- A coverage cell is marked ✅ only when every TC in the corresponding spec is green on a real test run (not just written) - the same "written is not done" rule as the exit criteria.
- The "Schema" column applies only to resources where a zod-validated spec has been adopted (per decision #3 in [tests/api/CLAUDE.md](tests/api/CLAUDE.md): one demonstration spec on `POST /users`).
- "Security" coverage means auth-gate coverage of write verbs (no-token and invalid-token EP classes). Per-token isolation is documented as a property where relevant but not actively verified across tokens (Section 3.2).
