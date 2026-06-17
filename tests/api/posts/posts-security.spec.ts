import type { APIResponse } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import { test, expect, BASE_URL } from "../../../fixtures";
import { PostsService } from "../../../services/PostsService";
import { createParentUser } from "../../../helpers/createParentUser";

// Posts inherits the Users security shape verb-for-verb (probed 2026-06-02 -
// 10 of 10 results matched predictions). The verb-dependent gate pattern
// already documented in tests/api/CLAUDE.md applies unchanged: POST is 401-
// gated, /posts/{id} verbs are 404-isolation-gated for no-auth, all verbs
// 401 on bogus-token. No new Posts-specific security gotchas - this spec
// just exercises the known properties on a new resource. Two TCs (TC12,
// TC13) cover the `/users/{user_id}/posts` nested-list endpoint which has
// no Users equivalent.

// Setup user + post shared across all TCs: real ids used (not placeholders)
// to prove anon CAN'T see/touch a post OUR token created. setupPostId per
// worker (Playwright `beforeAll` is worker-scoped). Cleanup in afterAll;
// cascade-delete on parent removal reaps the post too, but explicit per-id
// post cleanup keeps state legible.
let setupParentUserId: number;
let setupPostId: number;
let setupParentCleanup: () => Promise<void>;

test.beforeAll(async ({ authedRequest }) => {
  const parent = await createParentUser(authedRequest);
  setupParentUserId = parent.id;
  setupParentCleanup = parent.cleanup;

  const posts = new PostsService(authedRequest);
  const res = await posts.create(parent.id, {
    title: "Posts security setup post",
    body: "Setup body - never mutated by TCs; used as a target id only",
  });
  const body = await res.json();
  if (res.status() !== 201 || !body?.id) {
    throw new Error(
      `posts-security setup: expected 201 with body.id, got ${res.status()} ${JSON.stringify(body)}`,
    );
  }
  setupPostId = body.id;
});

test.afterAll(async ({ authedRequest }) => {
  if (setupPostId) {
    const posts = new PostsService(authedRequest);
    await posts.deleteById(setupPostId).catch(() => {});
  }
  if (setupParentCleanup) await setupParentCleanup();
});

// Filler payloads for write-verb auth-gate negatives. The auth gate fires
// BEFORE parent-validation and field-validation (gotcha-documented), so the
// payload contents don't reach the validation layer. user_id=1 is a placeholder
// that never resolves - it just needs to be a number to satisfy the type.
const VALID_PUT_BODY = {
  user_id: 1,
  title: "Hijack title via PUT",
  body: "Hijack body via PUT - should be rejected by auth gate",
};
const VALID_PATCH_BODY = { title: "Hijack title via PATCH" };

test.describe("Posts - security - POST auth-gate", () => {
  test("TC01 - POST /users/{user_id}/posts with no Authorization header - 401 'Authentication failed'", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const posts = new PostsService(ctx);
      const res = await posts.create(setupParentUserId, {
        title: "Hijack title",
        body: "Hijack body",
      });
      expect(res.status()).toBe(401);
      const body = await res.json();
      // Distinct from bogus-token's "Invalid token" - pinned per gotcha.
      expect(body).toEqual({ message: "Authentication failed" });
    } finally {
      await ctx.dispose();
    }
  });

  test("TC02 - POST /users/{user_id}/posts with bogus token 'deadbeef' - 401 'Invalid token'", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const posts = new PostsService(ctx);
      const res = await posts.create(setupParentUserId, {
        title: "Hijack title",
        body: "Hijack body",
      });
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});

// Action closures for the write-verb loops. Each takes a PostsService + an id
// and returns the APIResponse. Keeps the loop body uniform across PUT/PATCH/DELETE.
type WriteAction = (p: PostsService, id: number) => Promise<APIResponse>;

const writeVerbs: Array<{ verb: string; action: WriteAction }> = [
  { verb: "PUT", action: (p, id) => p.update(id, VALID_PUT_BODY) },
  { verb: "PATCH", action: (p, id) => p.patch(id, VALID_PATCH_BODY) },
  { verb: "DELETE", action: (p, id) => p.deleteById(id) },
];

test.describe("Posts - security - write-on-id no-auth (per-token isolation: 404 not 401)", () => {
  // The no-auth case for write verbs on /posts/{id} does NOT hit a 401 auth
  // gate - anonymous has no data slice, so any id appears as "Resource not
  // found". Using setupPostId (a real post our token can see) proves this is
  // an ISOLATION property, not just an id-not-found edge case.
  for (const [index, { verb, action }] of writeVerbs.entries()) {
    const tc = `TC0${index + 3}`; // TC03, TC04, TC05

    test(`${tc} - ${verb} /posts/{id} no Authorization - 404 'Resource not found'`, async () => {
      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        const posts = new PostsService(ctx);
        const res = await action(posts, setupPostId);
        expect(res.status()).toBe(404);
        const body = await res.json();
        expect(body).toEqual({ message: "Resource not found" });
      } finally {
        await ctx.dispose();
      }
    });
  }
});

test.describe("Posts - security - write-on-id bogus token (token validation: 401)", () => {
  for (const [index, { verb, action }] of writeVerbs.entries()) {
    const tc = `TC0${index + 6}`; // TC06, TC07, TC08

    test(`${tc} - ${verb} /posts/{id} bogus token - 401 'Invalid token'`, async () => {
      const ctx = await playwrightRequest.newContext({
        baseURL: BASE_URL,
        extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
      });
      try {
        const posts = new PostsService(ctx);
        const res = await action(posts, setupPostId);
        expect(res.status()).toBe(401);
        const body = await res.json();
        expect(body).toEqual({ message: "Invalid token" });
      } finally {
        await ctx.dispose();
      }
    });
  }
});

test.describe("Posts - security - GET /posts/{id} auth-gate", () => {
  test("TC09 - GET /posts/{id} no Authorization - 404 (anonymous list works but per-id reads do NOT due to isolation)", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const posts = new PostsService(ctx);
      const res = await posts.getById(setupPostId);
      expect(res.status()).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ message: "Resource not found" });
    } finally {
      await ctx.dispose();
    }
  });

  test("TC10 - GET /posts/{id} bogus token - 401 'Invalid token'", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const posts = new PostsService(ctx);
      const res = await posts.getById(setupPostId);
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Posts - security - GET /posts (list) bogus token", () => {
  test("TC11 - GET /posts (list) with bogus token - 401 (list is publicly readable WITHOUT a token but token validation fires when one is sent)", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const posts = new PostsService(ctx);
      const res = await posts.listAll();
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Posts - security - nested list (/users/{user_id}/posts) auth-gate", () => {
  // No-Users-equivalent describe block. The nested list endpoint diverges
  // from /posts/{id}'s isolation behavior: anon GET on /posts/{id} returns
  // 404, but anon GET on /users/{user_id}/posts for a token-owned parent
  // returns 200 + []. Same isolation CAUSE, different observable contract.
  // Worth pinning both halves of the divergence in tests.

  test("TC12 - GET /users/{setupUserId}/posts no Authorization - 200 + [] (isolation diverges from /{id})", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const posts = new PostsService(ctx);
      const res = await posts.listByUser(setupParentUserId);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      // Empty array - our token-owned post under this parent is invisible
      // to the anonymous slice, even though the SAME endpoint returns the
      // post when called authed.
      expect(body).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });

  test("TC13 - GET /users/{setupUserId}/posts bogus token - 401 'Invalid token'", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const posts = new PostsService(ctx);
      const res = await posts.listByUser(setupParentUserId);
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});
