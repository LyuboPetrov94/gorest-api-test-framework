# GoRest API Tests - Claude Instructions

## Project Overview
API testing framework for the GoRest sandbox API (https://gorest.co.in, v2 at `https://gorest.co.in/public/v2`). Portfolio-style continuation of the prior `playwright-framework` project, applying the same service-wrapper / fixture / schema patterns to a Bearer-token-authenticated REST API with per-token data isolation. GoRest specifically chosen for: real Bearer-token auth (vs Petstore's theatrical api_key), per-token state isolation (no shared-data flakiness), built-in error/delay simulation (`?force_status=N`, `?delay=N`), and testable rate-limiting (300 req/min default, returns 429 with `X-RateLimit-*` headers).

## User Context
- QA Engineer, ISTQB Foundation Level Certified
- Experienced with Cypress (UI E2E); Playwright (API + UI) background from prior framework project
- Comfortable with: POM, service-wrapper pattern, worker-scoped fixtures, inline-user helpers, zod schemas, ISTQB techniques (EP / BVA / decision tables / state transition), validator-priority pinning, auth-gate coverage
- New Playwright/dependency/test-design concepts: relate to existing knowledge where useful

## Workflow Mode - Inspect & Approve

**Claude writes all TypeScript and markdown. User reviews diffs in the IDE and runs tests.**

Three mandatory approval gates:

1. **Before any code is written**: Claude proposes the test-case list (TC numbers + names + brief intent). User approves. No code until then.
2. **After each resource's service + spec are written**: Claude runs a cross-file consistency review (assertion patterns, auth-gate coverage, try/finally placement, unused imports, TC numbering). User inspects the diff and runs tests. **No moving to the next resource until this gate clears.**
3. **Before any architectural change**: see "Stop-the-line Decisions" below. Claude proposes, user approves, then implements.

**Test runs:**
- Claude is permitted to run tests within a session after the user grants permission once per session.
- Test failures must be triaged by tracing the HTTP/IO sequence - do not assume "schema mismatch" or "race condition"; read the error and the relevant code.
- Do not claim "fixed" on a green run alone. Verify the *implementation* behaved correctly (the "verify implementation, not just test pass" discipline). Especially for cleanup paths, mentally trace the HTTP sequence - a 401 on a cleanup DELETE looks identical to success in the test report.

## Stop-the-line Decisions

Claude must NOT make these decisions alone - propose, get approval, then implement:

1. Adding any runtime or dev dependency
2. Extracting a new helper or fixture (vs leaving inline boilerplate)
3. Changing fixture scope (worker vs test)
4. Adopting or changing schema-validation scope (one spec / per-resource / global / none)
5. Modifying multi-project `testDir` config or adding/removing a project
6. Splitting or merging spec files
7. Adopting a new convention not already documented in CLAUDE.md
8. Marking a TC green when the implementation has not been verified end-to-end

## Project Structure
<!-- TODO: adapt this tree to actual scope (UI? API only? Both?) -->
```
tests/
  api/<resource>/      # API tests grouped by resource - see tests/api/CLAUDE.md
  ui/<feature>/        # UI/E2E - only if UI in scope; see tests/ui/CLAUDE.md
pages/                 # POMs - UI only
services/              # API service wrappers
schemas/               # zod schemas - if schema validation adopted
fixtures/              # Custom Playwright fixtures
helpers/               # Utility functions
```

## Subtree Instructions
This root file documents shared/cross-cutting rules. Surface-specific conventions live in `tests/<surface>/CLAUDE.md`. Claude Code auto-loads those when working in the relevant subtree.

## Workflow
Before writing any code for a new feature:
1. **Inspect the target** - for API, probe the endpoint and observe request/response shape, status codes, error envelopes
2. **Propose a list of test cases** applying the design techniques below
3. **Get explicit approval on the test-case list** before writing any test code
4. **Write supporting code first** (POM for UI, service wrapper for API), **then the spec**
5. **Cross-file consistency review** before marking the resource done

## Conventions
- Tests import `test` and `expect` from `fixtures/index.ts`, not directly from `@playwright/test`. **Type-only imports** (e.g. `import type { APIResponse } from '@playwright/test'`) are allowed directly from `@playwright/test`.
- Selectors / endpoints / test targets never appear directly in spec files - abstract through POMs (UI) or service wrappers (API).
- Test files named `<feature>.spec.ts`
- TC numbers must be sequential within a spec file - reorder and renumber when tests are added or removed
- For multi-step flows, use nested `test.describe` blocks with a separate `beforeEach` that completes the prerequisite step

## Running Tests
```bash
npm test                                        # all tests EXCEPT the rate-limit burst (--grep-invert @ratelimit)
npm run test:ratelimit                          # ONLY the @ratelimit burst (rate-limit.spec.ts TC03) - run in isolation
npx playwright test tests/api/<resource>        # specific resource
npx playwright test --project=api               # API only
npm run report                                  # HTML report
```

The `@ratelimit`-tagged burst (`tests/api/sandbox/rate-limit.spec.ts` TC03) fires ~400 concurrent **authed** requests to deliberately deplete the per-token 300/min bucket and prove 429 enforcement. It is excluded from the default run (`npm test` / `npm run test:api`) so it does not starve other authed specs' minute budget; run it alone via `npm run test:ratelimit`, and let the bucket recover (~60s) before running other authed specs. The rate-limit spec's header-contract TCs (TC01/TC02) are untagged and stay in the default suite.

Retries enabled (1) locally and on CI. Screenshot / video / trace use `*-on-failure` semantics - artifacts retained only when the final outcome is failed.

## Test Design Techniques

### Equivalence Partitioning
Divide inputs into valid and invalid equivalence classes. One test per class - do not repeat tests within the same class.

### Boundary Value Analysis (3-point)
For any range or limit, test three points: just below, at, and just above the boundary. **Keep all three points even when "at" and "above" produce the same outcome** - the points document the boundary's *shape*, not only outcome diversity.

### Decision Table
For features with multiple input conditions that combine into different outcomes, map all combinations before writing tests.

### State Transition
For multi-step flows, identify states and transitions. Cover valid transitions and attempt invalid ones (e.g. anon → login → authed → logout → anon).

## Assertion Preferences
- For UI: prefer Playwright's auto-retrying `Locator` assertions (`toHaveText`, `toBeVisible`, `toHaveCount`, etc.) over manual `await` + `toBe()`.
- For API: use plain `expect(value).toBe(...)` / `toEqual()` / `toMatchObject()`. API responses are static snapshots - nothing to retry against. `expect.poll` only for genuinely async API state.

## Unused Code Check
After writing a POM/service/spec, scan for unused methods, functions, exports, or variables before marking complete. For each unused item:
1. Identify why it went unused - speculative, or a gap pointing to a missed test case?
2. If it maps to a gap, propose the missing test rather than removing the helper.
3. If genuinely redundant, flag and propose deletion for explicit confirmation.
4. Report findings as part of the task summary - decisions visible, not hidden in the diff.

## What NOT to Do
- Do not write selectors / endpoints / test targets directly in spec files - abstract through POMs (UI) or service wrappers (API).
- Do not mark a test green when the implementation has not been verified end-to-end.
- Do not make stop-the-line decisions without explicit user approval.
- Do not add tests for a project (e.g. `api`) that hasn't been started.
