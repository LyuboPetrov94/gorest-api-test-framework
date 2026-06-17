import { request as playwrightRequest } from "@playwright/test";
import { test, expect, BASE_URL } from "../../../fixtures";
import { SandboxService } from "../../../services/SandboxService";
import { randomEmail, randomName } from "../../../helpers/data";

// GoRest's ?force_status=<code> is a sandbox knob that forces the server to
// return a chosen HTTP status with a simulated-error envelope, on demand. This
// is FAULT-INJECTION / robustness testing: exercising failure paths a real
// server won't produce when asked. force_status is cross-cutting middleware -
// route- and verb-agnostic, and it fires before auth AND before persistence
// (probed 2026-06-09). So one carrier endpoint (/users) with one representative
// non-GET verb covers the feature (EP: one class across all endpoints/verbs).
// See tests/api/CLAUDE.md "force_status" gotcha.
//
// No cleanup arrays in this spec: GETs create nothing, and the forced POST
// (TC10) is short-circuited before persistence - so nothing is ever created.

// Honored codes: real HTTP error statuses across the 4xx (client) and 5xx
// (server) families. All share ONE response shape, so this is a single EP class
// probed with representatives spanning both families (defense-in-depth).
const SIMULATED_CODES: Array<{ code: number; phrase: string }> = [
  { code: 400, phrase: "Bad Request" },
  { code: 404, phrase: "Not Found" },
  { code: 422, phrase: "Unprocessable Content" },
  { code: 500, phrase: "Internal Server Error" },
  { code: 503, phrase: "Service Unavailable" },
];

test.describe("Sandbox - force_status - simulated error responses", () => {
  for (const [index, { code, phrase }] of SIMULATED_CODES.entries()) {
    const tc = `TC0${index + 1}`; // TC01..TC05

    test(`${tc} - force_status=${code} returns ${code} with simulated envelope`, async ({
      authedRequest,
    }) => {
      const sandbox = new SandboxService(authedRequest);
      const res = await sandbox.forceStatus(code);

      expect(res.status()).toBe(code);
      const body = await res.json();
      expect(body).toEqual({
        message: `Simulated ${code} ${phrase}`,
        simulated: true,
      });
      // The simulation short-circuits the resource HANDLER but not the
      // surrounding middleware: rate-limit headers are still attached on authed
      // forced responses. (Presence, not value - the exact 300 limit is the
      // rate-limit spec's job and varies if a token's quota is raised.)
      expect(res.headers()["x-ratelimit-limit"]).toBeDefined();
    });
  }
});

// Values outside the honored set (2xx, out-of-range, non-numeric) are ignored;
// the request proceeds normally and returns the real 200 user list.
const IGNORED_VALUES: Array<number | string> = [200, 999, "abc"];

test.describe("Sandbox - force_status - unhonored values fall through", () => {
  for (const [index, value] of IGNORED_VALUES.entries()) {
    const tc = `TC0${index + 6}`; // TC06..TC08

    test(`${tc} - force_status=${value} is ignored, returns the real 200 list`, async ({
      authedRequest,
    }) => {
      const sandbox = new SandboxService(authedRequest);
      const res = await sandbox.forceStatus(value);

      expect(res.status()).toBe(200);
      const body = await res.json();
      // A real list is an ARRAY; the simulated envelope is an object. The shape
      // alone proves the value fell through rather than triggering a simulation.
      // (No assertion on specific seed records - the public seed is shared.)
      expect(Array.isArray(body)).toBe(true);
    });
  }
});

test.describe("Sandbox - force_status - fires before auth and before persistence", () => {
  test("TC09 - anonymous force_status=500 returns 500 simulated (precedes the auth gate)", async () => {
    // No Authorization header. Every other anonymous request we've documented
    // gets 401/404; force_status short-circuits ahead of auth, so the simulated
    // 500 comes back regardless of credentials.
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const sandbox = new SandboxService(ctx);
      const res = await sandbox.forceStatus(500);

      expect(res.status()).toBe(500);
      const body = await res.json();
      expect(body).toEqual({
        message: "Simulated 500 Internal Server Error",
        simulated: true,
      });
    } finally {
      await ctx.dispose();
    }
  });

  test("TC10 - authed POST force_status=500 returns 500 simulated and creates no resource", async ({
    authedRequest,
  }) => {
    const sandbox = new SandboxService(authedRequest);
    const res = await sandbox.forceStatusOnCreate(500, {
      name: randomName(),
      email: randomEmail(),
      gender: "female",
      status: "active",
    });

    expect(res.status()).toBe(500);
    const body = await res.json();
    // Exact envelope: only `message` + `simulated`, NO `id`. The absence of a
    // server-assigned id proves persistence was short-circuited - no user was
    // created, so there is nothing to clean up.
    expect(body).toEqual({
      message: "Simulated 500 Internal Server Error",
      simulated: true,
    });
  });
});
