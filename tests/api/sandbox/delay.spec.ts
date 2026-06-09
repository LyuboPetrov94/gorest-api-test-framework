import { request as playwrightRequest } from "@playwright/test";
import { test, expect, BASE_URL } from "../../../fixtures";
import { SandboxService } from "../../../services/SandboxService";

// GoRest's ?delay=<ms> holds the response for N milliseconds before returning -
// a knob for SLOW-RESPONSE / latency handling, a non-functional concern the
// prior Notes API could not exercise on demand. Probed 2026-06-09: delay is
// capped server-side at 5000ms, ignored for non-numeric values, NOT auth-gated,
// and loses to force_status when both are present (force_status short-circuits
// ahead of the delay middleware). Same EP reasoning as force_status - delay is
// cross-cutting middleware, so one carrier endpoint (/users) covers it. See
// tests/api/CLAUDE.md "delay" gotcha.
//
// Latency is asserted via wall-clock elapsed (Date.now() around the await):
// Playwright exposes no server-timing, and the server HOLDS the response at
// least `delay` ms, so client measurement only ever adds time - the lower bound
// `elapsed >= delay` is robust. No cleanup arrays: every TC is a GET that
// creates nothing.

test.describe("Sandbox - delay - latency applied (BVA on the 5000ms cap)", () => {
  test("TC01 - delay=1500 holds the response at least 1500ms, returns normal 200", async ({
    authedRequest,
  }) => {
    const sandbox = new SandboxService(authedRequest);
    const start = Date.now();
    const res = await sandbox.withDelay(1500);
    const elapsed = Date.now() - start;

    expect(res.status()).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(1500);
    // Latency only - the payload is the normal user list (an array), unchanged.
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("TC02 - delay=5000 (at the cap) holds the response at least 5000ms", async ({
    authedRequest,
  }) => {
    const sandbox = new SandboxService(authedRequest);
    const start = Date.now();
    const res = await sandbox.withDelay(5000);
    const elapsed = Date.now() - start;

    expect(res.status()).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(5000);
  });

  test("TC03 - delay=10000 (above the cap) is clamped to ~5000ms, not honored in full", async ({
    authedRequest,
  }) => {
    const sandbox = new SandboxService(authedRequest);
    const start = Date.now();
    const res = await sandbox.withDelay(10000);
    const elapsed = Date.now() - start;

    expect(res.status()).toBe(200);
    // Waited the cap...
    expect(elapsed).toBeGreaterThanOrEqual(5000);
    // ...but NOT the full 10s requested - proves the server-side 5000ms clamp.
    expect(elapsed).toBeLessThan(10000);
  });
});

test.describe("Sandbox - delay - edge behaviors", () => {
  test("TC04 - delay=abc (invalid) is ignored, returns a fast normal 200", async ({
    authedRequest,
  }) => {
    const sandbox = new SandboxService(authedRequest);
    const start = Date.now();
    const res = await sandbox.withDelay("abc");
    const elapsed = Date.now() - start;

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // No delay applied: comfortably under the smallest real delay (1500ms).
    expect(elapsed).toBeLessThan(1500);
  });

  test("TC05 - anonymous delay=1500 is honored (delay is not auth-gated)", async () => {
    // No Authorization header. delay fires regardless of credentials - it is
    // middleware ahead of the auth gate, same as force_status.
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const sandbox = new SandboxService(ctx);
      const start = Date.now();
      const res = await sandbox.withDelay(1500);
      const elapsed = Date.now() - start;

      expect(res.status()).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(1500);
    } finally {
      await ctx.dispose();
    }
  });

  test("TC06 - delay=1500 & force_status=503: force_status wins, delay not applied", async ({
    authedRequest,
  }) => {
    const sandbox = new SandboxService(authedRequest);
    const start = Date.now();
    const res = await sandbox.delayWithForcedStatus(1500, 503);
    const elapsed = Date.now() - start;

    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body).toEqual({
      message: "Simulated 503 Service Unavailable",
      simulated: true,
    });
    // force_status short-circuits ahead of the delay middleware: the response
    // comes back fast, NOT after 1500ms.
    expect(elapsed).toBeLessThan(1500);
  });
});
