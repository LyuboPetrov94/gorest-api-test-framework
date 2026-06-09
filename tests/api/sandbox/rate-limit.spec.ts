import { request as playwrightRequest } from "@playwright/test";
import { test, expect, BASE_URL } from "../../../fixtures";
import { SandboxService } from "../../../services/SandboxService";

// GoRest enforces a per-TOKEN rate limit: 300 requests/minute, implemented as a
// continuously-refilling token bucket (~5 req/sec), NOT a fixed window. Probed
// 2026-06-04 (gotcha in tests/api/CLAUDE.md): sequential traffic never depletes
// it (remaining stays ~299, reset 0); only a concurrent burst that outruns the
// refill drives it to 429. Rate-limit headers (x-ratelimit-*) appear ONLY on
// authed requests - anonymous traffic is not counted against the token bucket.
//
// TC03 fires an authed burst that drains the token's whole minute budget, so it
// is tagged @ratelimit and EXCLUDED from the default run (`npm test` /
// `npm run test:api` use --grep-invert @ratelimit). Run it in isolation via
// `npm run test:ratelimit`, then let the bucket recover (~60s) before other
// authed specs run. TC01/TC02 are cheap (one request each) and stay in the
// default suite. The header-contract assertions are BOUNDS (remaining <= limit,
// reset >= 0), so they hold even if a burst has already depleted the bucket -
// the spec is robust to TC ordering.

const RATE_LIMIT = 300;

test.describe("Sandbox - rate-limit - header contract", () => {
  test("TC01 - authed GET carries x-ratelimit headers within bounds", async ({
    authedRequest,
  }) => {
    const sandbox = new SandboxService(authedRequest);
    const res = await sandbox.list();
    const headers = res.headers();

    expect(res.status()).toBe(200);
    // Limit is the documented per-token ceiling.
    expect(headers["x-ratelimit-limit"]).toBe(String(RATE_LIMIT));
    // Remaining/reset are present and bounded. NOT an exact decrement: the
    // continuous refill makes the precise value non-deterministic (see gotcha).
    const remaining = Number(headers["x-ratelimit-remaining"]);
    const reset = Number(headers["x-ratelimit-reset"]);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThanOrEqual(RATE_LIMIT);
    expect(reset).toBeGreaterThanOrEqual(0);
  });

  test("TC02 - anonymous GET has no x-ratelimit headers (not counted against the token bucket)", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const sandbox = new SandboxService(ctx);
      const res = await sandbox.list();
      const headers = res.headers();

      expect(res.status()).toBe(200);
      expect(headers["x-ratelimit-limit"]).toBeUndefined();
      expect(headers["x-ratelimit-remaining"]).toBeUndefined();
      expect(headers["x-ratelimit-reset"]).toBeUndefined();
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Sandbox - rate-limit - 429 under concurrent burst", () => {
  test(
    "TC03 - an authed concurrent burst exceeds the bucket and returns 429s",
    { tag: "@ratelimit" },
    async ({ authedRequest }) => {
      // 400 concurrent requests can take a few seconds; lift the per-test
      // timeout above the 30s default as a margin against a slow network.
      test.setTimeout(60_000);
      const sandbox = new SandboxService(authedRequest);
      // > the 300 bucket, fired concurrently to outrun the ~5/sec refill.
      // Sequential calls would never reach 429 (the bucket refills faster than
      // slow traffic drains it).
      const BURST = 400;
      const responses = await Promise.all(
        Array.from({ length: BURST }, () => sandbox.list()),
      );
      const statuses = responses.map((r) => r.status());

      // At least one request is throttled - the per-token rate limit is
      // enforced. Re-running within ~60s leaves the bucket already depleted, so
      // let it recover between runs.
      expect(statuses).toContain(429);
    },
  );
});
