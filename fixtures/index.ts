import { test as base, APIRequestContext, request } from "@playwright/test";

/**
 * Custom fixtures for the GoRest API project.
 *
 * GoRest uses Bearer-token auth (Authorization: Bearer <token>). The token
 * is account-bound (not per-user-created), so the same token serves every
 * test. Per-token data isolation means cleanup and parallelism are reliable
 * within the project's namespace - see tests/api/CLAUDE.md decisions #1, #2, #4.
 */

// Origin only - service classes carry the full `/public/v2/<resource>` path
// per the API Conventions in tests/api/CLAUDE.md. Including `/public/v2` here
// would break WHATWG URL resolution: paths starting with `/` would replace
// the base path, not append it (verified empirically during initial probe).
export const BASE_URL = process.env.BASE_URL || "https://gorest.co.in";

// Token from .env (loaded by playwright.config.ts via dotenv). Fail loudly
// at module load time if missing - better than mysterious 401s in every test.
const TOKEN = process.env.GOREST_TOKEN;
if (!TOKEN) {
  throw new Error(
    "GOREST_TOKEN is not set. Create a .env file at the project root with " +
      "`GOREST_TOKEN=<your-token>`. See .env.example and CLAUDE.md.",
  );
}

type WorkerFixtures = {
  authedRequest: APIRequestContext;
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
        extraHTTPHeaders: { Authorization: `Bearer ${TOKEN}` },
      });
      await use(ctx);
      await ctx.dispose();
    },
    { scope: "worker" },
  ],
});

// Re-export expect so specs only need to import from this file
export { expect } from "@playwright/test";
