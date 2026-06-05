import type { APIResponse } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import { test, expect, BASE_URL } from "../../../fixtures";
import { TodosService } from "../../../services/TodosService";
import { createParentUser } from "../../../helpers/createParentUser";

// Todos inherits the Users/Posts security shape verb-for-verb (probed
// 2026-06-05 - anon nested list -> 200 [], anon GET-by-id -> 404, all matched
// predictions). The verb-dependent gate pattern documented in
// tests/api/CLAUDE.md applies unchanged: POST is 401-gated, /todos/{id} verbs
// are 404-isolation-gated for no-auth, all verbs 401 on bogus-token. No new
// Todos-specific security gotchas - this spec exercises the known properties on
// a new resource. TC12/TC13 cover the `/users/{user_id}/todos` nested-list
// endpoint (no Users equivalent).

// Setup user + todo shared across all TCs: real ids used (not placeholders) to
// prove anon CAN'T see/touch a todo OUR token created. setupTodoId per worker
// (Playwright `beforeAll` is worker-scoped). Cleanup in afterAll; cascade-delete
// on parent removal reaps the todo too, but explicit per-id cleanup is legible.
let setupParentUserId: number;
let setupTodoId: number;
let setupParentCleanup: () => Promise<void>;

test.beforeAll(async ({ authedRequest }) => {
  const parent = await createParentUser(authedRequest);
  setupParentUserId = parent.id;
  setupParentCleanup = parent.cleanup;

  const todos = new TodosService(authedRequest);
  const res = await todos.create(parent.id, {
    title: "Todos security setup todo",
    status: "pending",
  });
  const body = await res.json();
  if (res.status() !== 201 || !body?.id) {
    throw new Error(
      `todos-security setup: expected 201 with body.id, got ${res.status()} ${JSON.stringify(body)}`,
    );
  }
  setupTodoId = body.id;
});

test.afterAll(async ({ authedRequest }) => {
  if (setupTodoId) {
    const todos = new TodosService(authedRequest);
    await todos.deleteById(setupTodoId).catch(() => {});
  }
  if (setupParentCleanup) await setupParentCleanup();
});

// Filler payloads for write-verb auth-gate negatives. The auth gate fires
// BEFORE parent-validation and field-validation (gotcha-documented), so the
// payload contents never reach the validation layer. user_id=1 is a placeholder
// that never resolves - it just needs to be a number to satisfy the type.
const VALID_PUT_BODY = {
  user_id: 1,
  title: "Hijack title via PUT",
  status: "completed",
  due_on: null,
};
const VALID_PATCH_BODY = { title: "Hijack title via PATCH" };

test.describe("Todos - security - POST auth-gate", () => {
  test("TC01 - POST /users/{user_id}/todos with no Authorization header - 401 'Authentication failed'", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const todos = new TodosService(ctx);
      const res = await todos.create(setupParentUserId, {
        title: "Hijack title",
        status: "pending",
      });
      expect(res.status()).toBe(401);
      const body = await res.json();
      // Distinct from bogus-token's "Invalid token" - pinned per gotcha.
      expect(body).toEqual({ message: "Authentication failed" });
    } finally {
      await ctx.dispose();
    }
  });

  test("TC02 - POST /users/{user_id}/todos with bogus token 'deadbeef' - 401 'Invalid token'", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const todos = new TodosService(ctx);
      const res = await todos.create(setupParentUserId, {
        title: "Hijack title",
        status: "pending",
      });
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});

// Action closures for the write-verb loops. Each takes a TodosService + an id
// and returns the APIResponse. Keeps the loop body uniform across PUT/PATCH/DELETE.
type WriteAction = (t: TodosService, id: number) => Promise<APIResponse>;

const writeVerbs: Array<{ verb: string; action: WriteAction }> = [
  { verb: "PUT", action: (t, id) => t.update(id, VALID_PUT_BODY) },
  { verb: "PATCH", action: (t, id) => t.patch(id, VALID_PATCH_BODY) },
  { verb: "DELETE", action: (t, id) => t.deleteById(id) },
];

test.describe("Todos - security - write-on-id no-auth (per-token isolation: 404 not 401)", () => {
  // The no-auth case for write verbs on /todos/{id} does NOT hit a 401 auth
  // gate - anonymous has no data slice, so any id appears as "Resource not
  // found". Using setupTodoId (a real todo our token can see) proves this is an
  // ISOLATION property, not just an id-not-found edge case.
  for (const [index, { verb, action }] of writeVerbs.entries()) {
    const tc = `TC0${index + 3}`; // TC03, TC04, TC05
    test(`${tc} - ${verb} /todos/{id} no Authorization - 404 'Resource not found'`, async () => {
      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        const todos = new TodosService(ctx);
        const res = await action(todos, setupTodoId);
        expect(res.status()).toBe(404);
        const body = await res.json();
        expect(body).toEqual({ message: "Resource not found" });
      } finally {
        await ctx.dispose();
      }
    });
  }
});

test.describe("Todos - security - write-on-id bogus token (token validation: 401)", () => {
  for (const [index, { verb, action }] of writeVerbs.entries()) {
    const tc = `TC0${index + 6}`; // TC06, TC07, TC08
    test(`${tc} - ${verb} /todos/{id} bogus token - 401 'Invalid token'`, async () => {
      const ctx = await playwrightRequest.newContext({
        baseURL: BASE_URL,
        extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
      });
      try {
        const todos = new TodosService(ctx);
        const res = await action(todos, setupTodoId);
        expect(res.status()).toBe(401);
        const body = await res.json();
        expect(body).toEqual({ message: "Invalid token" });
      } finally {
        await ctx.dispose();
      }
    });
  }
});

test.describe("Todos - security - GET /todos/{id} auth-gate", () => {
  test("TC09 - GET /todos/{id} no Authorization - 404 (anonymous list works but per-id reads do NOT due to isolation)", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const todos = new TodosService(ctx);
      const res = await todos.getById(setupTodoId);
      expect(res.status()).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ message: "Resource not found" });
    } finally {
      await ctx.dispose();
    }
  });

  test("TC10 - GET /todos/{id} bogus token - 401 'Invalid token'", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const todos = new TodosService(ctx);
      const res = await todos.getById(setupTodoId);
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Todos - security - GET /todos (list) bogus token", () => {
  test("TC11 - GET /todos (list) with bogus token - 401 (list is publicly readable WITHOUT a token but token validation fires when one is sent)", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const todos = new TodosService(ctx);
      const res = await todos.listAll();
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Todos - security - nested list (/users/{user_id}/todos) auth-gate", () => {
  // The nested list endpoint diverges from /todos/{id}'s isolation behavior:
  // anon GET on /todos/{id} returns 404, but anon GET on /users/{user_id}/todos
  // for a token-owned parent returns 200 + []. Same isolation CAUSE, different
  // observable contract. Worth pinning both halves of the divergence.

  test("TC12 - GET /users/{setupUserId}/todos no Authorization - 200 + [] (isolation diverges from /{id})", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const todos = new TodosService(ctx);
      const res = await todos.listByUser(setupParentUserId);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      // Empty array - our token-owned todo under this parent is invisible to
      // the anonymous slice, even though the SAME endpoint returns the todo
      // when called authed.
      expect(body).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });

  test("TC13 - GET /users/{setupUserId}/todos bogus token - 401 'Invalid token'", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const todos = new TodosService(ctx);
      const res = await todos.listByUser(setupParentUserId);
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});
