import type { APIResponse } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import { test, expect, BASE_URL } from "../../../fixtures";
import { UsersService } from "../../../services/UsersService";
import { randomEmail, randomName } from "../../../helpers/data";

// Setup user shared across all TCs in this file: write-on-id and GET-by-id
// blocks target setupUserId to prove anonymous CAN'T see this real user that
// our token CAN see. Demonstrates per-token data isolation as a security
// property. setupUserId per worker (test.beforeAll is worker-scoped under
// Playwright's worker fixture model).
let setupUserId: number;

test.beforeAll(async ({ authedRequest }) => {
  const users = new UsersService(authedRequest);
  const res = await users.create({
    name: randomName(),
    email: randomEmail(),
    gender: "female",
    status: "active",
  });
  const body = await res.json();
  setupUserId = body.id;
});

test.afterAll(async ({ authedRequest }) => {
  if (setupUserId) {
    const users = new UsersService(authedRequest);
    await users.deleteById(setupUserId).catch(() => {});
  }
});

const VALID_PUT_BODY = {
  name: "Hijack",
  email: "hijack@example.com",
  gender: "male",
  status: "inactive",
};
const VALID_PATCH_BODY = { name: "Hijack" };

test.describe("Users - security - POST auth-gate", () => {
  test("TC01 - POST /users with no Authorization header - 401 'Authentication failed'", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const users = new UsersService(ctx);
      const res = await users.create({
        name: randomName(),
        email: randomEmail(),
        gender: "female",
        status: "active",
      });
      expect(res.status()).toBe(401);
      const body = await res.json();
      // Distinct from bogus-token's "Invalid token". Pinned per gotcha.
      expect(body).toEqual({ message: "Authentication failed" });
    } finally {
      await ctx.dispose();
    }
  });

  test("TC02 - POST /users with bogus token 'deadbeef' - 401 'Invalid token'", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const users = new UsersService(ctx);
      const res = await users.create({
        name: randomName(),
        email: randomEmail(),
        gender: "female",
        status: "active",
      });
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});

// Action closures for the write-verb loops. Each takes a UsersService + an id
// and returns the APIResponse. Keeps the loop body uniform across PUT/PATCH/DELETE.
type WriteAction = (u: UsersService, id: number) => Promise<APIResponse>;

const writeVerbs: Array<{ verb: string; action: WriteAction }> = [
  { verb: "PUT", action: (u, id) => u.update(id, VALID_PUT_BODY) },
  { verb: "PATCH", action: (u, id) => u.patch(id, VALID_PATCH_BODY) },
  { verb: "DELETE", action: (u, id) => u.deleteById(id) },
];

test.describe("Users - security - write-on-id no-auth (per-token isolation: 404 not 401)", () => {
  // The no-auth case for write verbs on /users/{id} does NOT hit a 401 auth
  // gate - anonymous has no data slice, so any id appears as "Resource not
  // found". Using setupUserId (a real user our token can see) proves this is
  // an ISOLATION property, not just an id-not-found edge case.
  for (const [index, { verb, action }] of writeVerbs.entries()) {
    const tc = `TC0${index + 3}`; // TC03, TC04, TC05
    test(`${tc} - ${verb} /users/{id} no Authorization - 404 'Resource not found'`, async () => {
      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        const users = new UsersService(ctx);
        const res = await action(users, setupUserId);
        expect(res.status()).toBe(404);
        const body = await res.json();
        expect(body).toEqual({ message: "Resource not found" });
      } finally {
        await ctx.dispose();
      }
    });
  }
});

test.describe("Users - security - write-on-id invalid token (token validation: 401)", () => {
  for (const [index, { verb, action }] of writeVerbs.entries()) {
    const tc = `TC0${index + 6}`; // TC06, TC07, TC08
    test(`${tc} - ${verb} /users/{id} bogus token - 401 'Invalid token'`, async () => {
      const ctx = await playwrightRequest.newContext({
        baseURL: BASE_URL,
        extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
      });
      try {
        const users = new UsersService(ctx);
        const res = await action(users, setupUserId);
        expect(res.status()).toBe(401);
        const body = await res.json();
        expect(body).toEqual({ message: "Invalid token" });
      } finally {
        await ctx.dispose();
      }
    });
  }
});

test.describe("Users - security - GET /users/{id} auth-gate", () => {
  test("TC09 - GET /users/{id} no Authorization - 404 (anonymous list works but per-id reads do NOT due to isolation)", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const users = new UsersService(ctx);
      const res = await users.getById(setupUserId);
      expect(res.status()).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ message: "Resource not found" });
    } finally {
      await ctx.dispose();
    }
  });

  test("TC10 - GET /users/{id} bogus token - 401 'Invalid token'", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const users = new UsersService(ctx);
      const res = await users.getById(setupUserId);
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Users - security - GET /users (list) bogus token", () => {
  test("TC11 - GET /users (list) with bogus token - 401 (list is publicly readable WITHOUT a token but token validation fires when one is sent)", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const users = new UsersService(ctx);
      const res = await users.list();
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});
