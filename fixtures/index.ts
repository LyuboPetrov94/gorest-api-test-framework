import { test as base, APIRequestContext, request } from "@playwright/test";

/**
 * Custom fixtures for the GoRest API project.
 *
 * GoRest uses Bearer-token auth (Authorization: Bearer <token>). A token is
 * ACCOUNT-bound: every token a GoRest account issues shares that account's
 * single data namespace. (Verified 2026-06-18: two tokens from the SAME account
 * see and mutate each other's records; only a token from a DIFFERENT account is
 * isolated.) This per-account isolation is what makes cleanup and parallelism
 * reliable within the suite's namespace - see tests/api/CLAUDE.md decisions
 * #1, #2, #4.
 *
 * - `authedRequest`    - the MAIN account token (GOREST_TOKEN_MAIN). Used by
 *                        every spec. Required: throws at module load if absent.
 * - `authedRequestSub` - a token from a SECOND, SEPARATE GoRest account
 *                        (GOREST_TOKEN_SUB). Used ONLY by the cross-account
 *                        isolation spec. Lazy: the env var is checked inside the
 *                        fixture, so only specs that depend on it require a
 *                        second token - the rest of the suite runs without one.
 */

// Origin only - service classes carry the full `/public/v2/<resource>` path
// per the API Conventions in tests/api/CLAUDE.md. Including `/public/v2` here
// would break WHATWG URL resolution: paths starting with `/` would replace
// the base path, not append it (verified empirically during initial probe).
export const BASE_URL = process.env.BASE_URL || "https://gorest.co.in";

// MAIN account token from .env (loaded by playwright.config.ts via dotenv).
// Fail loudly at module load if missing - better than mysterious 401s in every
// test. Required by the whole suite.
const TOKEN_MAIN = process.env.GOREST_TOKEN_MAIN;
if (!TOKEN_MAIN) {
  throw new Error(
    "GOREST_TOKEN_MAIN is not set. Create a .env file at the project root with " +
      "`GOREST_TOKEN_MAIN=<your-token>`. See .env.example and CLAUDE.md.",
  );
}

// SECOND-account token. NOT checked at load: only the cross-account isolation
// spec uses it, and authedRequestSub checks it at setup time - so the rest of
// the suite is unaffected when it is absent (e.g. secret-less Dependabot PRs).
const TOKEN_SUB = process.env.GOREST_TOKEN_SUB;

type WorkerFixtures = {
  authedRequest: APIRequestContext;
  authedRequestSub: APIRequestContext;
};

export const test = base.extend<{}, WorkerFixtures>({
  authedRequest: [
    async ({}, use) => {
      // Worker-scoped: one context per worker, reused across all tests in that
      // worker. No register/login setup (token IS the auth); no teardown
      // beyond dispose. extraHTTPHeaders is set at context creation time;
      // cannot be added retroactively.
      const ctx = await request.newContext({
        baseURL: BASE_URL,
        extraHTTPHeaders: { Authorization: `Bearer ${TOKEN_MAIN}` },
        // Per-request ceiling (default is 30s). GoRest normally responds in
        // well under a second; capping at 15s means a stalled setup request
        // fails fast with a clear timeout instead of eating the whole 30s
        // beforeAll-hook budget - so a transient stall surfaces a meaningful
        // error and the retry can recover (see the comments-security flake).
        timeout: 15_000,
      });
      await use(ctx);
      await ctx.dispose();
    },
    { scope: "worker" },
  ],

  // Same shape as authedRequest, bound to the SECOND account's token. The
  // throw lives here (not at module load) so only specs that actually depend on
  // this fixture require GOREST_TOKEN_SUB - the main suite never instantiates it.
  authedRequestSub: [
    async ({}, use) => {
      if (!TOKEN_SUB) {
        throw new Error(
          "GOREST_TOKEN_SUB is not set. The cross-account isolation spec needs a " +
            "token from a SECOND, separate GoRest account (a different sign-in " +
            "identity). Add `GOREST_TOKEN_SUB=<token>` to .env. See .env.example " +
            "and CLAUDE.md.",
        );
      }
      const ctx = await request.newContext({
        baseURL: BASE_URL,
        extraHTTPHeaders: { Authorization: `Bearer ${TOKEN_SUB}` },
        timeout: 15_000,
      });
      await use(ctx);
      await ctx.dispose();
    },
    { scope: "worker" },
  ],
});

// Re-export expect so specs only need to import from this file
export { expect } from "@playwright/test";
