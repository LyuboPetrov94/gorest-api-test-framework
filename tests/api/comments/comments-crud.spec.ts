import { test, expect, BASE_URL } from "../../../fixtures";
import { CommentsService } from "../../../services/CommentsService";
import { request as playwrightRequest } from "@playwright/test";
import { createParentPost } from "../../../helpers/createParentPost";
import { randomEmail, randomString } from "../../../helpers/data";

function randomName(): string {
  return `Commenter ${randomString(8)}`;
}

function randomCommentBody(): string {
  return `Comment body ${randomString(16)}. Lorem ipsum dolor sit amet.`;
}

// File-scope shared parent post (under a parent user), matching the Posts
// lifecycle. No remaining TC in this file mutates the parent post itself
// (reparent TC09 creates its own second parent), so a single parent per worker
// is safe and cheap. afterAll cleanup deletes the parent user, which - via the
// cascade-delete gotcha - reaps the parent post and any leaked child comments.
let parentPostId: number;
let parentCleanup: () => Promise<void>;

test.beforeAll(async ({ authedRequest }) => {
  const parent = await createParentPost(authedRequest);
  parentPostId = parent.postId;
  parentCleanup = parent.cleanup;
});

test.afterAll(async () => {
  if (parentCleanup) await parentCleanup();
});

test.describe("Comments - CRUD happy paths", () => {
  let createdCommentIds: number[];

  test.beforeEach(() => {
    createdCommentIds = [];
  });

  test.afterEach(async ({ authedRequest }) => {
    const comments = new CommentsService(authedRequest);
    // Per-comment cleanup is defensive belt-and-braces - afterAll's parent
    // cleanup cascade-deletes children too (gotcha), but explicit per-id
    // cleanup keeps state legible if cascade behavior ever changes.
    // `.catch(() => {})` handles already-deleted (TC07's state-transition
    // deletes its own comment).
    for (const id of createdCommentIds) {
      await comments.deleteById(id).catch(() => {});
    }
  });

  test("TC01 - GET /comments (anonymous) - 200, no rate-limit headers, 5-field shape, default page 10", async () => {
    // Anonymous context - no Authorization header. Per the gotcha catalogue,
    // GoRest's GET-list endpoints are publicly accessible without a token,
    // returning the public seed.
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const comments = new CommentsService(ctx);
      const res = await comments.listAll();

      expect(res.status()).toBe(200);

      // Anonymous = no rate-limit headers (gotcha)
      const headers = res.headers();
      expect(headers["x-ratelimit-limit"]).toBeUndefined();
      expect(headers["x-ratelimit-remaining"]).toBeUndefined();

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(10); // default page size

      // Shape lock: exactly 5 keys, no extras (subset matching would let a
      // server-added field slip through silently). `email` is the field that
      // distinguishes a comment from a post.
      const first = body[0];
      expect(Object.keys(first).sort()).toEqual([
        "body",
        "email",
        "id",
        "name",
        "post_id",
      ]);

      // Types - id and post_id are Number per gotcha (not String, not regex)
      expect(first.id).toEqual(expect.any(Number));
      expect(first.id).toBeGreaterThan(0);
      expect(first.post_id).toEqual(expect.any(Number));
      expect(first.post_id).toBeGreaterThan(0);
      expect(typeof first.name).toBe("string");
      expect(typeof first.email).toBe("string");
      expect(typeof first.body).toBe("string");
    } finally {
      await ctx.dispose();
    }
  });

  test("TC02 - GET /comments (authed) - same body shape PLUS x-ratelimit-* headers", async ({
    authedRequest,
  }) => {
    const comments = new CommentsService(authedRequest);
    const res = await comments.listAll();

    expect(res.status()).toBe(200);

    // Rate-limit headers present on authed requests (gotcha)
    const headers = res.headers();
    const limit = Number(headers["x-ratelimit-limit"]);
    const remaining = Number(headers["x-ratelimit-remaining"]);
    const reset = Number(headers["x-ratelimit-reset"]);

    expect(Number.isFinite(limit)).toBe(true);
    expect(Number.isFinite(remaining)).toBe(true);
    expect(Number.isFinite(reset)).toBe(true);
    expect(limit).toBeGreaterThan(0);
    // Loose check - at least this request consumed a quota slot. Other parallel
    // tests on the same worker may have consumed more; we don't pin an exact value.
    expect(remaining).toBeLessThan(limit);

    // Body shape parity with TC01
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(Object.keys(body[0]).sort()).toEqual([
      "body",
      "email",
      "id",
      "name",
      "post_id",
    ]);
  });

  test("TC03 - POST /posts/{post_id}/comments - 201 with server-assigned id, body echoes payload, post_id matches path", async ({
    authedRequest,
  }) => {
    const comments = new CommentsService(authedRequest);
    const payload = {
      name: randomName(),
      email: randomEmail(),
      body: randomCommentBody(),
    };

    const res = await comments.create(parentPostId, payload);
    const body = await res.json();

    // Push for cleanup BEFORE assertions - a failing assertion below should
    // still leave a deleteable id behind.
    if (body?.id) createdCommentIds.push(body.id);

    expect(res.status()).toBe(201);
    expect(res.headers()["content-type"]).toContain("application/json");

    expect(body.id).toEqual(expect.any(Number));
    expect(body.id).toBeGreaterThan(0);
    expect(body.name).toBe(payload.name);
    expect(body.email).toBe(payload.email);
    expect(body.body).toBe(payload.body);
    // Parentage contract: response post_id equals the path post_id
    expect(body.post_id).toBe(parentPostId);
  });

  test("TC04 - GET /comments/{id} (authed) - round-trip identity (create then fetch returns equal body)", async ({
    authedRequest,
  }) => {
    const comments = new CommentsService(authedRequest);
    const payload = {
      name: randomName(),
      email: randomEmail(),
      body: randomCommentBody(),
    };
    const createRes = await comments.create(parentPostId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdCommentIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    const getRes = await comments.getById(createBody.id);
    expect(getRes.status()).toBe(200);
    const getBody = await getRes.json();

    // Deep equality - GoRest returns the same shape from GET as from POST
    expect(getBody).toEqual(createBody);
  });

  // TC05 + TC06 note: GoRest's PUT is loose (behaves like PATCH - accepts
  // partials, preserves unsent fields). Per the gotcha catalogue. Both TCs
  // exist for verb-coverage; they do not prove distinct semantics on this API.

  test("TC05 - PUT /comments/{id} - full replace: name/email/body change, id and post_id preserved", async ({
    authedRequest,
  }) => {
    const comments = new CommentsService(authedRequest);
    const original = {
      name: randomName(),
      email: randomEmail(),
      body: randomCommentBody(),
    };
    const createRes = await comments.create(parentPostId, original);
    const createBody = await createRes.json();
    if (createBody?.id) createdCommentIds.push(createBody.id);

    const replacement = {
      post_id: parentPostId,
      name: randomName(),
      email: randomEmail(),
      body: randomCommentBody(),
    };
    const putRes = await comments.update(createBody.id, replacement);
    expect(putRes.status()).toBe(200);

    const putBody = await putRes.json();
    expect(putBody.id).toBe(createBody.id); // id preserved across replace
    expect(putBody.post_id).toBe(parentPostId); // post_id preserved
    expect(putBody.name).toBe(replacement.name);
    expect(putBody.email).toBe(replacement.email);
    expect(putBody.body).toBe(replacement.body);
  });

  test("TC06 - PATCH /comments/{id} - partial update: body changes, name and email unchanged", async ({
    authedRequest,
  }) => {
    const comments = new CommentsService(authedRequest);
    const original = {
      name: randomName(),
      email: randomEmail(),
      body: randomCommentBody(),
    };
    const createRes = await comments.create(parentPostId, original);
    const createBody = await createRes.json();
    if (createBody?.id) createdCommentIds.push(createBody.id);

    const newBody = randomCommentBody();
    const patchRes = await comments.patch(createBody.id, { body: newBody });
    expect(patchRes.status()).toBe(200);

    const patchBody = await patchRes.json();
    expect(patchBody.id).toBe(createBody.id);
    expect(patchBody.post_id).toBe(parentPostId);
    expect(patchBody.body).toBe(newBody); // changed
    // The partial-update property: unsent fields preserve original values
    expect(patchBody.name).toBe(original.name);
    expect(patchBody.email).toBe(original.email);
  });

  test("TC07 - DELETE /comments/{id} state transition: 204 then 404 on follow-up GET", async ({
    authedRequest,
  }) => {
    const comments = new CommentsService(authedRequest);
    const payload = {
      name: randomName(),
      email: randomEmail(),
      body: randomCommentBody(),
    };
    const createRes = await comments.create(parentPostId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdCommentIds.push(createBody.id);

    const delRes = await comments.deleteById(createBody.id);
    expect(delRes.status()).toBe(204);
    // 204 = No Content; assert the body is genuinely empty (not just JSON-empty)
    const delText = await delRes.text();
    expect(delText).toBe("");

    // State transition verification: GET should now 404 with JSON envelope
    const getRes = await comments.getById(createBody.id);
    expect(getRes.status()).toBe(404);
    const getBody = await getRes.json();
    expect(getBody).toEqual({ message: "Resource not found" });
  });

  test("TC08 - GET /comments pagination headers contract: pages == ceil(total / limit)", async ({
    authedRequest,
  }) => {
    const comments = new CommentsService(authedRequest);
    const res = await comments.listAll();
    expect(res.status()).toBe(200);

    const headers = res.headers();

    // All four pagination headers present and Number-parseable
    const limit = Number(headers["x-pagination-limit"]);
    const page = Number(headers["x-pagination-page"]);
    const pages = Number(headers["x-pagination-pages"]);
    const total = Number(headers["x-pagination-total"]);

    expect(limit).toBe(10);
    expect(page).toBe(1);
    expect(pages).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(0);
    // Meaningful invariant: pages = ceil(total / limit). Catches off-by-one
    // and "pages reports stale total" regressions. Same invariant pinned on
    // users-crud TC08 and posts-crud TC08.
    expect(pages).toBe(Math.ceil(total / limit));

    // Link headers - `x-links-previous` is empty string on page 1, don't assert it
    expect(headers["x-links-current"]).toMatch(/[?&]page=1\b/);
    expect(headers["x-links-next"]).toBeTruthy();
  });

  test("TC09 - PATCH /comments/{id} {post_id: <other>} - 200, comment reparented to new post", async ({
    authedRequest,
  }) => {
    // Mutability contract: `post_id` is an updatable foreign key on PATCH/PUT
    // (gotcha-documented). PATCH chosen as the single representative since the
    // property is verb-agnostic - PUT-reparent would prove the same property
    // through a different verb. Parent-existence validation on bogus post_id
    // for both verbs is covered in comments-validation.
    const comments = new CommentsService(authedRequest);
    const payload = {
      name: randomName(),
      email: randomEmail(),
      body: randomCommentBody(),
    };
    const createRes = await comments.create(parentPostId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdCommentIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    // Second parent post owned by this TC - cleaned in `finally` so it's
    // removed even if assertions fail. After the PATCH reparents, this post
    // becomes the new parent; its cleanup (deletes the post's user) cascade-
    // deletes the comment too.
    const otherParent = await createParentPost(authedRequest);
    try {
      const patchRes = await comments.patch(createBody.id, {
        post_id: otherParent.postId,
      });
      expect(patchRes.status()).toBe(200);

      const patchBody = await patchRes.json();
      expect(patchBody.id).toBe(createBody.id);
      // Mutability: response shows the NEW post_id, not the original
      expect(patchBody.post_id).toBe(otherParent.postId);
      expect(patchBody.post_id).not.toBe(parentPostId);
      // PATCH partial: name/email/body preserved since only post_id was sent
      expect(patchBody.name).toBe(payload.name);
      expect(patchBody.email).toBe(payload.email);
      expect(patchBody.body).toBe(payload.body);
    } finally {
      await otherParent.cleanup();
    }
  });
});

test.describe("Comments - DELETE state transitions (negatives)", () => {
  // Companion to TC07's happy-path DELETE. TC07 covers `exists -> deleted`;
  // these two cover the remaining target states: `never existed` and
  // `already deleted`. Both produce 404 with the same envelope as a GET on a
  // non-existent id - GoRest does not return RFC-pure 204 on idempotent DELETE,
  // it honestly reports "gone".
  let createdCommentIds: number[];

  test.beforeEach(() => {
    createdCommentIds = [];
  });

  test.afterEach(async ({ authedRequest }) => {
    const comments = new CommentsService(authedRequest);
    for (const id of createdCommentIds) {
      await comments.deleteById(id).catch(() => {});
    }
  });

  test("TC10 - DELETE /comments/{id} for non-existent id - 404 {message:'Resource not found'}", async ({
    authedRequest,
  }) => {
    // Reuses the same 99999999 sentinel as the parent-existence TCs in
    // comments-validation. EP class: target does not exist (never created).
    const comments = new CommentsService(authedRequest);
    const res = await comments.deleteById(99999999);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ message: "Resource not found" });
  });

  test("TC11 - DELETE /comments/{id} idempotency: second DELETE on same id - 404 (state transition exists -> deleted -> still-deleted)", async ({
    authedRequest,
  }) => {
    // State-transition: state `exists` -> first DELETE (204) -> state `deleted`
    // -> second DELETE (404). The RFC says DELETE is idempotent in terms of
    // server STATE (resource is gone either way), not response code. GoRest's
    // 204-then-404 pattern is RFC-compliant and matches conventional REST.
    const comments = new CommentsService(authedRequest);
    const payload = {
      name: randomName(),
      email: randomEmail(),
      body: randomCommentBody(),
    };
    const createRes = await comments.create(parentPostId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdCommentIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    const firstDel = await comments.deleteById(createBody.id);
    expect(firstDel.status()).toBe(204);
    expect(await firstDel.text()).toBe("");

    const secondDel = await comments.deleteById(createBody.id);
    expect(secondDel.status()).toBe(404);
    const body = await secondDel.json();
    expect(body).toEqual({ message: "Resource not found" });
  });
});
