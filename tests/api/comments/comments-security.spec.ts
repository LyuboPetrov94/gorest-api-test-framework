import type { APIResponse } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import { test, expect, BASE_URL } from "../../../fixtures";
import { CommentsService } from "../../../services/CommentsService";
import { createParentPost } from "../../../helpers/createParentPost";
import { randomEmail } from "../../../helpers/data";

// Comments inherit the Users/Posts security shape verb-for-verb (probed
// 2026-06-04 - every result matched predictions). The verb-dependent gate
// pattern documented in tests/api/CLAUDE.md applies unchanged: POST is 401-
// gated, /comments/{id} verbs are 404-isolation-gated for no-auth, all verbs
// 401 on bogus-token. No new Comments-specific security gotchas - this spec
// exercises the known properties on a new resource. Two TCs (TC12, TC13) cover
// the `/posts/{post_id}/comments` nested-list endpoint, mirroring posts-
// security's `/users/{user_id}/posts` coverage.

// Setup parent post + comment shared across all TCs: real ids used (not
// placeholders) to prove anon CAN'T see/touch a comment OUR token created.
// Per worker (Playwright `beforeAll` is worker-scoped). Cleanup in afterAll;
// deleting the parent user cascade-deletes the post AND the comment, but
// explicit per-id comment cleanup keeps state legible.
let setupParentPostId: number;
let setupCommentId: number;
let setupParentCleanup: () => Promise<void>;

test.beforeAll(async ({ authedRequest }) => {
  const parent = await createParentPost(authedRequest);
  setupParentPostId = parent.postId;
  setupParentCleanup = parent.cleanup;

  const comments = new CommentsService(authedRequest);
  const res = await comments.create(parent.postId, {
    name: "Comments security setup",
    email: randomEmail(),
    body: "Setup body - never mutated by TCs; used as a target id only",
  });
  const body = await res.json();
  if (res.status() !== 201 || !body?.id) {
    throw new Error(
      `comments-security setup: expected 201 with body.id, got ${res.status()} ${JSON.stringify(body)}`,
    );
  }
  setupCommentId = body.id;
});

test.afterAll(async ({ authedRequest }) => {
  if (setupCommentId) {
    const comments = new CommentsService(authedRequest);
    await comments.deleteById(setupCommentId).catch(() => {});
  }
  if (setupParentCleanup) await setupParentCleanup();
});

// Filler payloads for write-verb auth-gate negatives. The auth gate fires
// BEFORE parent-validation and field-validation (gotcha-documented), so the
// payload contents don't reach the validation layer. post_id=1 is a placeholder
// that never resolves - it just needs to be a number to satisfy the type.
const VALID_PUT_BODY = {
  post_id: 1,
  name: "Hijack via PUT",
  email: "hijack@example.com",
  body: "Hijack body via PUT - should be rejected by auth gate",
};
const VALID_PATCH_BODY = { body: "Hijack body via PATCH" };

test.describe("Comments - security - POST auth-gate", () => {
  test("TC01 - POST /posts/{post_id}/comments with no Authorization header - 401 'Authentication failed'", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const comments = new CommentsService(ctx);
      const res = await comments.create(setupParentPostId, {
        name: "Hijack",
        email: "hijack@example.com",
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

  test("TC02 - POST /posts/{post_id}/comments with bogus token 'deadbeef' - 401 'Invalid token'", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const comments = new CommentsService(ctx);
      const res = await comments.create(setupParentPostId, {
        name: "Hijack",
        email: "hijack@example.com",
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

// Action closures for the write-verb loops. Each takes a CommentsService + an
// id and returns the APIResponse. Keeps the loop body uniform across
// PUT/PATCH/DELETE.
type WriteAction = (c: CommentsService, id: number) => Promise<APIResponse>;

const writeVerbs: Array<{ verb: string; action: WriteAction }> = [
  { verb: "PUT", action: (c, id) => c.update(id, VALID_PUT_BODY) },
  { verb: "PATCH", action: (c, id) => c.patch(id, VALID_PATCH_BODY) },
  { verb: "DELETE", action: (c, id) => c.deleteById(id) },
];

test.describe("Comments - security - write-on-id no-auth (per-token isolation: 404 not 401)", () => {
  // The no-auth case for write verbs on /comments/{id} does NOT hit a 401 auth
  // gate - anonymous has no data slice, so any id appears as "Resource not
  // found". Using setupCommentId (a real comment our token can see) proves this
  // is an ISOLATION property, not just an id-not-found edge case.
  for (const [index, { verb, action }] of writeVerbs.entries()) {
    const tc = `TC0${index + 3}`; // TC03, TC04, TC05
    test(`${tc} - ${verb} /comments/{id} no Authorization - 404 'Resource not found'`, async () => {
      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        const comments = new CommentsService(ctx);
        const res = await action(comments, setupCommentId);
        expect(res.status()).toBe(404);
        const body = await res.json();
        expect(body).toEqual({ message: "Resource not found" });
      } finally {
        await ctx.dispose();
      }
    });
  }
});

test.describe("Comments - security - write-on-id bogus token (token validation: 401)", () => {
  for (const [index, { verb, action }] of writeVerbs.entries()) {
    const tc = `TC0${index + 6}`; // TC06, TC07, TC08
    test(`${tc} - ${verb} /comments/{id} bogus token - 401 'Invalid token'`, async () => {
      const ctx = await playwrightRequest.newContext({
        baseURL: BASE_URL,
        extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
      });
      try {
        const comments = new CommentsService(ctx);
        const res = await action(comments, setupCommentId);
        expect(res.status()).toBe(401);
        const body = await res.json();
        expect(body).toEqual({ message: "Invalid token" });
      } finally {
        await ctx.dispose();
      }
    });
  }
});

test.describe("Comments - security - GET /comments/{id} auth-gate", () => {
  test("TC09 - GET /comments/{id} no Authorization - 404 (anonymous list works but per-id reads do NOT due to isolation)", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const comments = new CommentsService(ctx);
      const res = await comments.getById(setupCommentId);
      expect(res.status()).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ message: "Resource not found" });
    } finally {
      await ctx.dispose();
    }
  });

  test("TC10 - GET /comments/{id} bogus token - 401 'Invalid token'", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const comments = new CommentsService(ctx);
      const res = await comments.getById(setupCommentId);
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Comments - security - GET /comments (list) bogus token", () => {
  test("TC11 - GET /comments (list) with bogus token - 401 (list is publicly readable WITHOUT a token but token validation fires when one is sent)", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const comments = new CommentsService(ctx);
      const res = await comments.listAll();
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("Comments - security - nested list (/posts/{post_id}/comments) auth-gate", () => {
  // The nested list endpoint diverges from /comments/{id}'s isolation behavior:
  // anon GET on /comments/{id} returns 404, but anon GET on
  // /posts/{post_id}/comments for a token-owned parent returns 200 + []. Same
  // isolation CAUSE, different observable contract. Worth pinning both halves.

  test("TC12 - GET /posts/{setupPostId}/comments no Authorization - 200 + [] (isolation diverges from /{id})", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const comments = new CommentsService(ctx);
      const res = await comments.listByPost(setupParentPostId);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      // Empty array - our token-owned comment under this parent is invisible
      // to the anonymous slice, even though the SAME endpoint returns the
      // comment when called authed.
      expect(body).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });

  test("TC13 - GET /posts/{setupPostId}/comments bogus token - 401 'Invalid token'", async () => {
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: "Bearer deadbeef" },
    });
    try {
      const comments = new CommentsService(ctx);
      const res = await comments.listByPost(setupParentPostId);
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ message: "Invalid token" });
    } finally {
      await ctx.dispose();
    }
  });
});
