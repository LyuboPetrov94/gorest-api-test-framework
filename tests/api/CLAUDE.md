# API Test Instructions

Applies to tests under `tests/api/` and their service wrappers in `services/`. Complements the root `CLAUDE.md` - read both. Claude Code auto-loads this file when working within this subtree.

## Project-Specific Decisions (FILL BEFORE WRITING THE SECOND SPEC)

These five decisions must be locked before broader spec work begins. Retrofitting them later is painful.

1. **Auth mechanism**: **Bearer token in `Authorization: Bearer <token>` header.** Token is a personal access token obtained from `https://gorest.co.in/` (sign in with GitHub/Google/Microsoft, generate from account dashboard). Loaded from `process.env.GOREST_TOKEN` in `.env` (gitignored; see `.env.example`) at config load time via `dotenv`. The `authedRequest` fixture in `fixtures/index.ts` injects the header at context creation. Fixture fails loudly at load if the token is missing - better than mysterious 401s in every test. GoRest also accepts the token as `?access-token=<token>` query parameter; we use the header form exclusively for consistency.

2. **Test user lifecycle**: **The User in GoRest is a *resource* (CRUD over a directory of people), not an auth identity.** The Bearer token is account-bound and serves every test in this project. So **no inline-user-helpers-for-auth pattern is needed** - the prior project's `registerAndLogin`/`setupAuthedUser` have no equivalent here. User-resource tests use the same lifecycle pattern as Notes from the prior project: `createdIds` array + `afterEach` cleanup loop. Per-token isolation ("Records you create or modify are only visible to your access token") means User records created in tests cannot interfere with other tokens or with the public seed data.

3. **Schema validation scope**: **One spec demonstration on `POST /users`** (parallels the prior project's L8). GoRest's response shapes are documented and stable, so per-resource schemas would be reliable - but one-spec demo is enough for portfolio purposes and keeps maintenance surface small. Schemas live in `schemas/UserSchemas.ts`.

4. **Cleanup discipline**: GoRest supports DELETE on every created resource (`/users/{id}`, `/posts/{id}`, `/comments/{id}`, `/todos/{id}`). Per-token isolation makes deletes reliable: nobody else can delete your records first. `afterEach` cleanup via `createdIds` arrays per spec; wrap individual delete calls in `.catch(() => {})` as belt-and-braces against test-action-already-deleted cases. The 24-hour auto-reseed is the ultimate safety net for any leaked records.

5. **Project framing**: **Portfolio** - continuation of the prior framework project. Lean toward defense-in-depth: pin both auth-gate EP classes (missing token AND invalid token - GoRest returns proper 401s, so these are meaningful), pin literal values in schemas, document discovered API quirks thoroughly in the gotcha catalogue below. **Bonus targets unique to GoRest** that should appear as separate specs: (a) `?force_status=500` triggers - verifying the framework handles 5xx correctly; (b) `?delay=N` triggers - verifying slow-response handling; (c) 429 + `X-RateLimit-Remaining` header behavior - a real demonstration of rate-limit testing, rare in portfolio projects.

**Until these are filled, Claude must not start writing specs.** Proposed TC lists may proceed in parallel with filling these, but the gates above (especially #1 and #2) determine how the fixture and helpers are designed.

## API Conventions
- Service wrappers live in `services/`. Endpoint paths and HTTP verbs belong in services, never in spec files. Service is the API equivalent of a Page Object Model.
- Specs use the `request` fixture (`async ({ request }) => {...}`) - not `page.request`. API specs do not need a browser; the `api` project in `playwright.config.ts` runs them without one.
- Test file path: `tests/api/<resource>/<feature>.spec.ts`. Group by resource, not by lesson. Resource folders are **plural** to mirror the API's resource naming (`users/` ↔ `/users/login`).
- Every `project` in `playwright.config.ts` declares an explicit `testDir`. Without overrides, projects inherit the global `testDir` and run every spec across every project, multiplying counts.
- `baseURL` is the origin only. Service paths carry the full route prefix so each service is self-documenting against the API spec.
- For per-verb HTTP methods use `request.get/post/put/patch/delete`. Use `request.fetch(url, { method })` only when the verb is dynamic (negative tests, parameterised loops).
- **Body encoding**: JSON only. Every GoRest endpoint accepts `application/json` request bodies and returns JSON responses. Use Playwright's `{ data: { ... } }` option, never `{ form: ... }` or `{ multipart: ... }`. (Contrast with the prior project's Notes API which was `application/x-www-form-urlencoded`.) Service wrappers should default to `request.post(this.endpoint, { data: payload })`.

## Service Design Rules
- Service constructor takes `APIRequestContext` via DI and stores it `private readonly`.
- The endpoint path is stored as `private readonly endpoint = '...'` at the top of the class - single source of truth, never duplicated across methods.
- Public methods return `Promise<APIResponse>`. Do not pre-parse or assert on the response inside the service - spec owns assertion logic.
- Methods accept arguments in the order they appear in the API contract (path params → required body fields → optional fields). Group multi-field bodies into a single object parameter when there are more than three fields.
- A negative-path method that needs to send a non-standard verb uses `request.fetch(this.endpoint, { method })` rather than a switch over per-verb methods.

## Assertion Preferences (API-specific)
- HTTP-layer status: `expect(response.status()).toBe(N)`. `status()` is a function call, not a property.
- Body: `const body = await response.json(); expect(body.success).toBe(true);` - always pin at least one more field beyond `success` (a `message`, `status` mirror, or `data` value) so a regression returning `{ success: true }` with empty payload doesn't silently pass.
- **No auto-retrying assertions** for API responses. `toHaveText`, `toBeVisible`, etc. are UI-only - tied to `Locator`. An API response is a fixed snapshot.
- For genuinely async API state (e.g. waiting for a background-job status field to flip), use `expect.poll(() => fetchStatus(), { timeout: N }).toBe('done')`. Reserved for that case - do not reach for `expect.poll` when an immediate assertion will do.
- For empty or non-JSON bodies (e.g. HTML 404 pages), assert status only. Do not assert on HTML body strings - coupling to the error-page framework is fragile.

## Test Data & Parallelism Conventions

<!-- TODO: the patterns below assume decision #2 = "API has register + login + delete". Adapt or remove sections if the lifecycle is different. -->

**Worker fixture vs inline-user setup - pick by what the test does to the user:**
- Use the worker `authedRequest` fixture when the test treats the user as a stable, opaque dependency. One user per worker, shared across tests in that worker. Cheap, no setup ceremony - but state leaks between tests on the same worker.
- Use **inline-user setup** when the test needs to:
  - know the user's credentials (e.g. "change-password and verify the old password fails after change")
  - mutate credentials or identity
  - invalidate auth mid-test (logout, delete-account)
  - set up a second authed user in the same TC (cross-user isolation tests)
- The fixture stays **opaque on purpose** - exposes only `APIRequestContext`, not credentials. Don't extend it to leak credentials. Specs that need them use inline helpers.

**Helper layering (when inline-user is needed):**
- `registerAndLogin(baseURL)` - credentials-only primitive. Returns `{ email, password, name, userId, token }`. Manages a one-shot context internally.
- `setupAuthedUser(baseURL)` - common-case helper. Returns `{ user, ctx }` - credentials AND a ready-to-use authed context. Default choice.
- `deleteAccountByCredentials(baseURL, email, password)` - re-authenticates with credentials to obtain a fresh token, then deletes. Use when the test invalidated its own token mid-flow (logout, delete-account, second-call orphaned-token scenarios). The naive `users.deleteAccount().catch(() => {})` returns 401 silently and leaks accounts.

**Cleanup for inline users - try/finally per test:**
- Create resources before `try`, clean up in `finally`.
- Order in `finally`: resource cleanup *first* (uses the context), then `ctx.dispose()` (releases the context).
- Auth-gate negatives that don't register a real user (no-token, bad-token tests) don't need user cleanup. Just `ctx.dispose()` in `finally`.

**Parallelism:**
- Default to `fullyParallel: true`.
- Default to test independence. Each test resets or recreates the state it needs.
- `test.describe.serial` is the escape hatch for genuinely-sequential flows that can't be made independent - not a convenience for "I want tests in order."

**Auth-gate coverage convention:**
- Two EP classes per authed endpoint: missing auth header AND invalid token. Different responses, distinct EP classes.
- Pin both classes on every authed endpoint via inline unauthed contexts. Use a standard bogus-token sentinel for consistency (e.g. `"deadbeef"`).
- Auth-gate negatives are cheap: one `playwrightRequest.newContext` + one assertion block per EP class. The gate fires before payload validation, so no real user needed.

## Schema Validation

<!-- TODO: include or remove this section based on decision #3. -->

Adopt `zod` v4.x if schema validation is in scope. Conventions:

- **Library**: `zod` v4.x. v4 API differs from v3: `ZodSafeParseResult<T>` (single type param), not v3's `SafeParseReturnType<I, O>`. `issue.path` is `PropertyKey[]` - use `.map(String).join(".")` to satisfy TypeScript.
- **File layout**: schemas in `schemas/<Resource>Schemas.ts`; one inner resource schema (`<Resource>Schema`) embedded in each envelope schema (`Create<Resource>ResponseSchema`, `Get<Resource>ResponseSchema`).
- **Use `safeParse`, not `parse`**. `parse` throws; `safeParse` returns `{ success, data?, error? }` - assertion-friendly. Plays nicely with `expect(result.success).toBe(true)`.
- **Inline a `formatZodError(result)` helper** at the top of each schema spec. Pass it as the second argument to `expect().toBe(true)`. Turns failures from `expected false to be true` into `<path>: <message>`.
- **Use `.strict()` on every object schema**. Unknown keys → schema fails. This is the regression net - the whole point of zod over `toMatchObject`.
- **Pin literal values on the envelope**: `success: z.literal(true)`, `status: z.literal(200)`, exact `message: z.literal("...")` strings - not `z.string()`. The literal lock catches structural bugs in test code (the L8 lesson: a test POSTing-but-asserting-against-GET-schema was caught instantly by the literal `message` mismatch).
- **Reuse the inner resource schema across endpoints**. Define `<Resource>Schema` once, embed it inside every envelope schema for that resource. Only the envelope `message` literal differs.
- **Required negative-of-the-schema TC**: every schema spec needs at least one TC that feeds the schema a deliberately malformed value and asserts `result.success === false` with the error path. Without it, an accidentally-permissive schema (e.g. `z.object({}).passthrough()`) silently green-passes every happy-path TC. This is the unit-test-of-the-schema, separate from the integration tests of the API.

## Known Gotchas

Gotcha catalogue - fills as we probe the API and find behaviors that contradict the spec or HTTP conventions. Entries below were discovered during the initial `/users` probe (2026-05-29).

- **`baseURL` must be origin-only - paths carry the `/public/v2/` prefix**: WHATWG URL resolution treats request paths starting with `/` as absolute relative to origin, REPLACING the base path. `new URL("/users", "https://gorest.co.in/public/v2")` resolves to `https://gorest.co.in/users` (which is the marketing site's 404 page), NOT `https://gorest.co.in/public/v2/users`. Both `fixtures/index.ts` `BASE_URL` and `playwright.config.ts` `use.baseURL` are set to `https://gorest.co.in`; service classes carry the full `/public/v2/<resource>` prefix. This convention is already documented under "API Conventions" - this gotcha entry exists because we violated it on first attempt and got 404 HTML responses.

- **GET endpoints are publicly accessible - auth gate applies to write verbs only**: GoRest's docs imply Bearer token is required everywhere, but empirically `GET /users` returns 200 with no Authorization header. Token validation only triggers when a token is *sent* (see next gotcha). Test design implication: auth-gate negatives (no-token / invalid-token EP classes) are meaningful on POST/PATCH/PUT/DELETE but partially redundant on GETs. For GETs, document the "anonymous works" behavior as a TC (it's a positive contract worth pinning), and don't expect 401 on missing token.

- **Bogus token returns 401 even on public endpoints**: Sending `Authorization: Bearer deadbeef` to `GET /users` returns 401 `{ "message": "Invalid token" }` even though the same endpoint returns 200 with no Authorization header at all. GoRest validates tokens whenever one is presented, regardless of endpoint requirements. Test design implication: the two auth-gate EP classes (no-token / invalid-token) diverge on a *per-endpoint* basis - for GETs they produce 200 vs 401, for writes they likely both produce 401. Pin both classes; document the divergence.

- **Rate-limit headers (`x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`) appear only on authenticated requests**: Anonymous GETs do not include them. Rate-limit testing must be done with the Bearer token attached. Assertion shape: `expect(Number(response.headers()["x-ratelimit-remaining"])).toBeLessThan(90)` etc., guarded by an auth-required call.

- **No response envelope - pagination is in headers**: GoRest returns the bare resource (array for lists, object for single items) in the body. Pagination metadata is in response headers (`x-pagination-limit/page/pages/total`), navigation links in `x-links-current/next/previous` (the latter is empty string on page 1). No `{ data: ..., meta: ... }` wrapping like v1 had. Assertions target the body directly (`body[0].id`, not `body.data[0].id`).

- **`id` is a JavaScript number (int64-shaped), not a string**: GoRest returns `id` as a number like `8481864`. Contrast with the prior project's Notes API which returned 24-char hex ObjectId strings. Assert with `expect.any(Number)` or a `> 0` integer check; never `expect.any(String)` and never a regex.

- **POST returns 201, DELETE returns 204 with empty body**: RFC-correct REST semantics, unlike the prior Notes API (POST=200, DELETE=200+JSON). POST body echoes the created resource including server-assigned `id`. DELETE returns no body at all - `response.text()` returns empty string, `response.json()` would throw. Assert status only on DELETE.

- **404 envelope is `{ "message": "Resource not found" }`**: Consistent JSON shape across not-found cases. Safe to `await response.json()` on 404 responses; `body.message` is the field to pin.

- **`PUT /users/{id}` is loose - behaves identically to `PATCH /users/{id}`**: Standard REST says PUT means full replacement (sending a subset should be 422 or wipe unsent fields to defaults). GoRest's PUT accepts partial bodies, preserves unsent fields, and returns 200. Probed empirically 2026-05-29: PUT with `{ name }`, with `{}`, and with `{ name, email }` all returned 200 with only the supplied fields changed and the rest preserved. Test design implications: (1) the verbs are functionally equivalent on this API - TC05 (PUT all-4) and TC06 (PATCH partial) document both verbs work but do *not* prove distinct semantics; (2) **do not write a "PUT requires field X" validation TC** - it's not true; (3) `UpdateUserPayload` in `services/UsersService.ts` keeps all fields required as a *defensive convention* (forces callers to think about full state at the call site, encodes the standard REST intent in TypeScript), even though the API is more permissive - TS is stricter than the server here on purpose, per portfolio framing (decision #5: lean toward defense-in-depth).

- **Validation errors return as `[{field, message}]` array, status 422**: Different envelope from the 404 case (`{message}`). Example: `[{"field":"email","message":"is invalid"}]`. Two distinct error envelope shapes on the same API. Tests assert on the array shape - use `expect(body).toContainEqual({field, message})` or iterate / `.find()` by field name.

- **GoRest aggregates ALL validation errors per request** - not first-failure-wins. POST with multiple invalid fields returns one error per invalid field, all in the response array. Observed field order on POST: `name, gender, status, email` (likely the declaration order in the underlying model). **Do not pin field order in assertions** - couples tests to internal model declaration. Use set semantics: assert that the array contains the expected error fields, not that they appear in a specific order. Contrast with the prior project's Notes API which short-circuited at the first failure.

- **`gender` enum accepts only `male`/`female`, case-insensitively**: `"Female"` returns 201 with `response.gender === "female"` (case normalized server-side). `"other"` is rejected despite the term sometimes appearing in GoRest docs. Error message has a server-side typo: `"can't be blank, can be male of female"` (literal "of" instead of "or") - pin this exactly in assertions; do not silently correct it.

- **`status` enum accepts only `active`/`inactive`, case-insensitively**: Same case-normalization as gender. Error message is **terser** than gender's: just `"can't be blank"` - does not enumerate the allowed values. API-design asymmetry vs gender (which lists them). Pin the exact message rather than substring-matching.

- **`name` length bounds: 1–200 characters**: 0 → `name "can't be blank"`; 201+ → `name "is too long (maximum is 200 characters)"`. The max value appears in the error message itself, making the server self-documenting.

- **PATCH and PUT reuse POST validators on sent fields**: Both verbs apply the same validation rules to whatever fields are present in the body. Unsent fields are not validated (consistent with PUT-is-loose + PATCH-partial). Implication: validation negative coverage lives primarily on POST; one TC each for PATCH and PUT (with one invalid sent field) suffices to document verb-parity, no need to repeat the full validation matrix per verb.

## API-Specific What NOT to Do
- Do not write endpoint paths or HTTP verbs directly in spec files - abstract through service wrappers in `services/`.
- Do not assert on the body of 4xx responses without inspecting the body first - they may be HTML, not JSON, and `await response.json()` will throw.
- Do not use auto-retrying `Locator` assertions on API responses.
- Do not skip the cross-file consistency review per-resource (workflow gate #2 in root CLAUDE.md).
- Do not start writing specs before the five project-specific decisions at the top of this file are filled in.
