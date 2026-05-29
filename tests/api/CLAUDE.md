# API Test Instructions

Applies to tests under `tests/api/` and their service wrappers in `services/`. Complements the root `CLAUDE.md` — read both. Claude Code auto-loads this file when working within this subtree.

## Project-Specific Decisions (FILL BEFORE WRITING THE SECOND SPEC)

These five decisions must be locked before broader spec work begins. Retrofitting them later is painful.

1. **Auth mechanism**: **Bearer token in `Authorization: Bearer <token>` header.** Token is a personal access token obtained from `https://gorest.co.in/` (sign in with GitHub/Google/Microsoft, generate from account dashboard). Loaded from `process.env.GOREST_TOKEN` in `.env` (gitignored; see `.env.example`) at config load time via `dotenv`. The `authedRequest` fixture in `fixtures/index.ts` injects the header at context creation. Fixture fails loudly at load if the token is missing — better than mysterious 401s in every test. GoRest also accepts the token as `?access-token=<token>` query parameter; we use the header form exclusively for consistency.

2. **Test user lifecycle**: **The User in GoRest is a *resource* (CRUD over a directory of people), not an auth identity.** The Bearer token is account-bound and serves every test in this project. So **no inline-user-helpers-for-auth pattern is needed** — the prior project's `registerAndLogin`/`setupAuthedUser` have no equivalent here. User-resource tests use the same lifecycle pattern as Notes from the prior project: `createdIds` array + `afterEach` cleanup loop. Per-token isolation ("Records you create or modify are only visible to your access token") means User records created in tests cannot interfere with other tokens or with the public seed data.

3. **Schema validation scope**: **One spec demonstration on `POST /users`** (parallels the prior project's L8). GoRest's response shapes are documented and stable, so per-resource schemas would be reliable — but one-spec demo is enough for portfolio purposes and keeps maintenance surface small. Schemas live in `schemas/UserSchemas.ts`.

4. **Cleanup discipline**: GoRest supports DELETE on every created resource (`/users/{id}`, `/posts/{id}`, `/comments/{id}`, `/todos/{id}`). Per-token isolation makes deletes reliable: nobody else can delete your records first. `afterEach` cleanup via `createdIds` arrays per spec; wrap individual delete calls in `.catch(() => {})` as belt-and-braces against test-action-already-deleted cases. The 24-hour auto-reseed is the ultimate safety net for any leaked records.

5. **Project framing**: **Portfolio** — continuation of the prior framework project. Lean toward defense-in-depth: pin both auth-gate EP classes (missing token AND invalid token — GoRest returns proper 401s, so these are meaningful), pin literal values in schemas, document discovered API quirks thoroughly in the gotcha catalogue below. **Bonus targets unique to GoRest** that should appear as separate specs: (a) `?force_status=500` triggers — verifying the framework handles 5xx correctly; (b) `?delay=N` triggers — verifying slow-response handling; (c) 429 + `X-RateLimit-Remaining` header behavior — a real demonstration of rate-limit testing, rare in portfolio projects.

**Until these are filled, Claude must not start writing specs.** Proposed TC lists may proceed in parallel with filling these, but the gates above (especially #1 and #2) determine how the fixture and helpers are designed.

## API Conventions
- Service wrappers live in `services/`. Endpoint paths and HTTP verbs belong in services, never in spec files. Service is the API equivalent of a Page Object Model.
- Specs use the `request` fixture (`async ({ request }) => {...}`) — not `page.request`. API specs do not need a browser; the `api` project in `playwright.config.ts` runs them without one.
- Test file path: `tests/api/<resource>/<feature>.spec.ts`. Group by resource, not by lesson. Resource folders are **plural** to mirror the API's resource naming (`users/` ↔ `/users/login`).
- Every `project` in `playwright.config.ts` declares an explicit `testDir`. Without overrides, projects inherit the global `testDir` and run every spec across every project, multiplying counts.
- `baseURL` is the origin only. Service paths carry the full route prefix so each service is self-documenting against the API spec.
- For per-verb HTTP methods use `request.get/post/put/patch/delete`. Use `request.fetch(url, { method })` only when the verb is dynamic (negative tests, parameterised loops).
- **Body encoding**: JSON only. Every GoRest endpoint accepts `application/json` request bodies and returns JSON responses. Use Playwright's `{ data: { ... } }` option, never `{ form: ... }` or `{ multipart: ... }`. (Contrast with the prior project's Notes API which was `application/x-www-form-urlencoded`.) Service wrappers should default to `request.post(this.endpoint, { data: payload })`.

## Service Design Rules
- Service constructor takes `APIRequestContext` via DI and stores it `private readonly`.
- The endpoint path is stored as `private readonly endpoint = '...'` at the top of the class — single source of truth, never duplicated across methods.
- Public methods return `Promise<APIResponse>`. Do not pre-parse or assert on the response inside the service — spec owns assertion logic.
- Methods accept arguments in the order they appear in the API contract (path params → required body fields → optional fields). Group multi-field bodies into a single object parameter when there are more than three fields.
- A negative-path method that needs to send a non-standard verb uses `request.fetch(this.endpoint, { method })` rather than a switch over per-verb methods.

## Assertion Preferences (API-specific)
- HTTP-layer status: `expect(response.status()).toBe(N)`. `status()` is a function call, not a property.
- Body: `const body = await response.json(); expect(body.success).toBe(true);` — always pin at least one more field beyond `success` (a `message`, `status` mirror, or `data` value) so a regression returning `{ success: true }` with empty payload doesn't silently pass.
- **No auto-retrying assertions** for API responses. `toHaveText`, `toBeVisible`, etc. are UI-only — tied to `Locator`. An API response is a fixed snapshot.
- For genuinely async API state (e.g. waiting for a background-job status field to flip), use `expect.poll(() => fetchStatus(), { timeout: N }).toBe('done')`. Reserved for that case — do not reach for `expect.poll` when an immediate assertion will do.
- For empty or non-JSON bodies (e.g. HTML 404 pages), assert status only. Do not assert on HTML body strings — coupling to the error-page framework is fragile.

## Test Data & Parallelism Conventions

<!-- TODO: the patterns below assume decision #2 = "API has register + login + delete". Adapt or remove sections if the lifecycle is different. -->

**Worker fixture vs inline-user setup — pick by what the test does to the user:**
- Use the worker `authedRequest` fixture when the test treats the user as a stable, opaque dependency. One user per worker, shared across tests in that worker. Cheap, no setup ceremony — but state leaks between tests on the same worker.
- Use **inline-user setup** when the test needs to:
  - know the user's credentials (e.g. "change-password and verify the old password fails after change")
  - mutate credentials or identity
  - invalidate auth mid-test (logout, delete-account)
  - set up a second authed user in the same TC (cross-user isolation tests)
- The fixture stays **opaque on purpose** — exposes only `APIRequestContext`, not credentials. Don't extend it to leak credentials. Specs that need them use inline helpers.

**Helper layering (when inline-user is needed):**
- `registerAndLogin(baseURL)` — credentials-only primitive. Returns `{ email, password, name, userId, token }`. Manages a one-shot context internally.
- `setupAuthedUser(baseURL)` — common-case helper. Returns `{ user, ctx }` — credentials AND a ready-to-use authed context. Default choice.
- `deleteAccountByCredentials(baseURL, email, password)` — re-authenticates with credentials to obtain a fresh token, then deletes. Use when the test invalidated its own token mid-flow (logout, delete-account, second-call orphaned-token scenarios). The naive `users.deleteAccount().catch(() => {})` returns 401 silently and leaks accounts.

**Cleanup for inline users — try/finally per test:**
- Create resources before `try`, clean up in `finally`.
- Order in `finally`: resource cleanup *first* (uses the context), then `ctx.dispose()` (releases the context).
- Auth-gate negatives that don't register a real user (no-token, bad-token tests) don't need user cleanup. Just `ctx.dispose()` in `finally`.

**Parallelism:**
- Default to `fullyParallel: true`.
- Default to test independence. Each test resets or recreates the state it needs.
- `test.describe.serial` is the escape hatch for genuinely-sequential flows that can't be made independent — not a convenience for "I want tests in order."

**Auth-gate coverage convention:**
- Two EP classes per authed endpoint: missing auth header AND invalid token. Different responses, distinct EP classes.
- Pin both classes on every authed endpoint via inline unauthed contexts. Use a standard bogus-token sentinel for consistency (e.g. `"deadbeef"`).
- Auth-gate negatives are cheap: one `playwrightRequest.newContext` + one assertion block per EP class. The gate fires before payload validation, so no real user needed.

## Schema Validation

<!-- TODO: include or remove this section based on decision #3. -->

Adopt `zod` v4.x if schema validation is in scope. Conventions:

- **Library**: `zod` v4.x. v4 API differs from v3: `ZodSafeParseResult<T>` (single type param), not v3's `SafeParseReturnType<I, O>`. `issue.path` is `PropertyKey[]` — use `.map(String).join(".")` to satisfy TypeScript.
- **File layout**: schemas in `schemas/<Resource>Schemas.ts`; one inner resource schema (`<Resource>Schema`) embedded in each envelope schema (`Create<Resource>ResponseSchema`, `Get<Resource>ResponseSchema`).
- **Use `safeParse`, not `parse`**. `parse` throws; `safeParse` returns `{ success, data?, error? }` — assertion-friendly. Plays nicely with `expect(result.success).toBe(true)`.
- **Inline a `formatZodError(result)` helper** at the top of each schema spec. Pass it as the second argument to `expect().toBe(true)`. Turns failures from `expected false to be true` into `<path>: <message>`.
- **Use `.strict()` on every object schema**. Unknown keys → schema fails. This is the regression net — the whole point of zod over `toMatchObject`.
- **Pin literal values on the envelope**: `success: z.literal(true)`, `status: z.literal(200)`, exact `message: z.literal("...")` strings — not `z.string()`. The literal lock catches structural bugs in test code (the L8 lesson: a test POSTing-but-asserting-against-GET-schema was caught instantly by the literal `message` mismatch).
- **Reuse the inner resource schema across endpoints**. Define `<Resource>Schema` once, embed it inside every envelope schema for that resource. Only the envelope `message` literal differs.
- **Required negative-of-the-schema TC**: every schema spec needs at least one TC that feeds the schema a deliberately malformed value and asserts `result.success === false` with the error path. Without it, an accidentally-permissive schema (e.g. `z.object({}).passthrough()`) silently green-passes every happy-path TC. This is the unit-test-of-the-schema, separate from the integration tests of the API.

## Known Gotchas

<!-- Gotcha catalogue — empty at start. Fills as we probe the API and find behaviors that contradict the spec or HTTP conventions. Format below: -->

<!-- - **<Short title>**: <One-paragraph description of the gotcha, including the discovered behavior, why it's surprising (vs spec / vs REST best practice / vs intuition), the test design implication, and the assertion shape that locks it.> -->

## API-Specific What NOT to Do
- Do not write endpoint paths or HTTP verbs directly in spec files — abstract through service wrappers in `services/`.
- Do not assert on the body of 4xx responses without inspecting the body first — they may be HTML, not JSON, and `await response.json()` will throw.
- Do not use auto-retrying `Locator` assertions on API responses.
- Do not skip the cross-file consistency review per-resource (workflow gate #2 in root CLAUDE.md).
- Do not start writing specs before the five project-specific decisions at the top of this file are filled in.
