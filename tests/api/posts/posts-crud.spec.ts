import { test, expect, BASE_URL } from "../../../fixtures";
import { PostsService } from "../../../services/PostsService";
import { request as playwrightRequest } from "@playwright/test";
import { createParentUser } from "../../../helpers/createParentUser";
import { randomString } from "../../../helpers/data";

function randomTitle(): string {
  return `Post title ${randomString(8)}`;
}

function randomBody(): string {
  return `Post body ${randomString(16)}. Lorem ipsum dolor sit amet.`;
}

// File-scope shared parent user, matching posts-validation's lifecycle. No
// remaining TC in this file mutates the parent (parent-not-found TCs moved
// to posts-validation), so a single parent per worker is safe and cheap.
// afterAll cleanup reaps the parent and - via the cascade-delete gotcha -
// any leaked child posts.
let parentUserId: number;
let parentCleanup: () => Promise<void>;

test.beforeAll(async ({ authedRequest }) => {
  const parent = await createParentUser(authedRequest);
  parentUserId = parent.id;
  parentCleanup = parent.cleanup;
});

test.afterAll(async () => {
  if (parentCleanup) await parentCleanup();
});

test.describe("Posts - CRUD happy paths", () => {
  let createdPostIds: number[];

  test.beforeEach(() => {
    createdPostIds = [];
  });

  test.afterEach(async ({ authedRequest }) => {
    const posts = new PostsService(authedRequest);
    // Per-post cleanup is defensive belt-and-braces - afterAll's parent
    // cleanup cascade-deletes children too (gotcha), but explicit per-id
    // cleanup keeps state legible if cascade behavior ever changes.
    // `.catch(() => {})` handles already-deleted (TC07's state-transition
    // deletes its own post).
    for (const id of createdPostIds) {
      await posts.deleteById(id).catch(() => {});
    }
  });

  test("TC01 - GET /posts (anonymous) - 200, no rate-limit headers, 4-field shape, default page 10", async () => {
    // Anonymous context - no Authorization header. Per the gotcha catalogue,
    // GoRest's GET-list endpoints are publicly accessible without a token,
    // returning the public seed.
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const posts = new PostsService(ctx);
      const res = await posts.listAll();

      expect(res.status()).toBe(200);

      // Anonymous = no rate-limit headers (gotcha)
      const headers = res.headers();
      expect(headers["x-ratelimit-limit"]).toBeUndefined();
      expect(headers["x-ratelimit-remaining"]).toBeUndefined();

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(10); // default page size

      // Shape lock: exactly 4 keys, no extras (subset matching would let
      // a server-added field slip through silently)
      const first = body[0];
      expect(Object.keys(first).sort()).toEqual([
        "body",
        "id",
        "title",
        "user_id",
      ]);

      // Types - id and user_id are Number per gotcha (not String, not regex)
      expect(first.id).toEqual(expect.any(Number));
      expect(first.id).toBeGreaterThan(0);
      expect(first.user_id).toEqual(expect.any(Number));
      expect(first.user_id).toBeGreaterThan(0);
      expect(typeof first.title).toBe("string");
      expect(typeof first.body).toBe("string");
    } finally {
      await ctx.dispose();
    }
  });

  test("TC02 - GET /posts (authed) - same body shape PLUS x-ratelimit-* headers", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const res = await posts.listAll();

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
      "id",
      "title",
      "user_id",
    ]);
  });

  test("TC03 - POST /users/{user_id}/posts - 201 with server-assigned id, body echoes payload, user_id matches path", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const payload = { title: randomTitle(), body: randomBody() };

    const res = await posts.create(parentUserId, payload);
    const body = await res.json();

    // Push for cleanup BEFORE assertions - a failing assertion below should
    // still leave a deleteable id behind.
    if (body?.id) createdPostIds.push(body.id);

    expect(res.status()).toBe(201);
    expect(res.headers()["content-type"]).toContain("application/json");

    expect(body.id).toEqual(expect.any(Number));
    expect(body.id).toBeGreaterThan(0);
    expect(body.title).toBe(payload.title);
    expect(body.body).toBe(payload.body);
    // Parentage contract: response user_id equals the path user_id
    expect(body.user_id).toBe(parentUserId);
  });

  test("TC04 - GET /posts/{id} (authed) - round-trip identity (create then fetch returns equal body)", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const payload = { title: randomTitle(), body: randomBody() };
    const createRes = await posts.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdPostIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    const getRes = await posts.getById(createBody.id);
    expect(getRes.status()).toBe(200);
    const getBody = await getRes.json();

    // Deep equality - GoRest returns the same shape from GET as from POST
    expect(getBody).toEqual(createBody);
  });

  // TC05 + TC06 note: GoRest's PUT is loose like Users (behaves like PATCH -
  // accepts partials, preserves unsent fields). Per the gotcha catalogue. Both
  // TCs exist for verb-coverage; they do not prove distinct semantics on this API.

  test("TC05 - PUT /posts/{id} - full replace: title and body change, id and user_id preserved", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const original = { title: randomTitle(), body: randomBody() };
    const createRes = await posts.create(parentUserId, original);
    const createBody = await createRes.json();
    if (createBody?.id) createdPostIds.push(createBody.id);

    const replacement = {
      user_id: parentUserId,
      title: randomTitle(),
      body: randomBody(),
    };
    const putRes = await posts.update(createBody.id, replacement);
    expect(putRes.status()).toBe(200);

    const putBody = await putRes.json();
    expect(putBody.id).toBe(createBody.id); // id preserved across replace
    expect(putBody.user_id).toBe(parentUserId); // user_id preserved
    expect(putBody.title).toBe(replacement.title);
    expect(putBody.body).toBe(replacement.body);
  });

  test("TC06 - PATCH /posts/{id} - partial update: title changes, body unchanged", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const original = { title: randomTitle(), body: randomBody() };
    const createRes = await posts.create(parentUserId, original);
    const createBody = await createRes.json();
    if (createBody?.id) createdPostIds.push(createBody.id);

    const newTitle = randomTitle();
    const patchRes = await posts.patch(createBody.id, { title: newTitle });
    expect(patchRes.status()).toBe(200);

    const patchBody = await patchRes.json();
    expect(patchBody.id).toBe(createBody.id);
    expect(patchBody.user_id).toBe(parentUserId);
    expect(patchBody.title).toBe(newTitle); // changed
    // The partial-update property: unsent fields preserve original values
    expect(patchBody.body).toBe(original.body);
  });

  test("TC07 - DELETE /posts/{id} state transition: 204 then 404 on follow-up GET", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const payload = { title: randomTitle(), body: randomBody() };
    const createRes = await posts.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdPostIds.push(createBody.id);

    const delRes = await posts.deleteById(createBody.id);
    expect(delRes.status()).toBe(204);
    // 204 = No Content; assert the body is genuinely empty (not just JSON-empty)
    const delText = await delRes.text();
    expect(delText).toBe("");

    // State transition verification: GET should now 404 with JSON envelope
    const getRes = await posts.getById(createBody.id);
    expect(getRes.status()).toBe(404);
    const getBody = await getRes.json();
    expect(getBody).toEqual({ message: "Resource not found" });
  });

  test("TC08 - GET /posts pagination headers contract: pages == ceil(total / limit)", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const res = await posts.listAll();
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
    // users-crud TC08.
    expect(pages).toBe(Math.ceil(total / limit));

    // Link headers - `x-links-previous` is empty string on page 1, don't assert it
    expect(headers["x-links-current"]).toMatch(/[?&]page=1\b/);
    expect(headers["x-links-next"]).toBeTruthy();
  });

  test("TC09 - PATCH /posts/{id} {user_id: <other>} - 200, post reparented to new user", async ({
    authedRequest,
  }) => {
    // Mutability contract: `user_id` is an updatable foreign key on PATCH/PUT
    // (gotcha-documented). PATCH chosen as the single representative since the
    // property is verb-agnostic - PUT-reparent would prove the same property
    // through a different verb. Parent-existence validation on bogus user_id
    // for both verbs is covered in posts-validation TC18/TC19.
    const posts = new PostsService(authedRequest);
    const payload = { title: randomTitle(), body: randomBody() };
    const createRes = await posts.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdPostIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    // Second parent owned by this TC - cleaned in `finally` so it's removed
    // even if assertions fail. After the PATCH reparents, this user becomes
    // the new parent; its cleanup cascade-deletes the post too.
    const otherParent = await createParentUser(authedRequest);
    try {
      const patchRes = await posts.patch(createBody.id, {
        user_id: otherParent.id,
      });
      expect(patchRes.status()).toBe(200);

      const patchBody = await patchRes.json();
      expect(patchBody.id).toBe(createBody.id);
      // Mutability: response shows the NEW user_id, not the original
      expect(patchBody.user_id).toBe(otherParent.id);
      expect(patchBody.user_id).not.toBe(parentUserId);
      // PATCH partial: title/body preserved since only user_id was sent
      expect(patchBody.title).toBe(payload.title);
      expect(patchBody.body).toBe(payload.body);
    } finally {
      await otherParent.cleanup();
    }
  });
});

test.describe("Posts - DELETE state transitions (negatives)", () => {
  // Companion to TC07's happy-path DELETE. TC07 covers `exists -> deleted`;
  // these two cover the remaining target states: `never existed` and
  // `already deleted`. Both produce 404 with the same envelope as a GET on a
  // non-existent id - GoRest does not return RFC-pure 204 on idempotent DELETE,
  // it honestly reports "gone".
  let createdPostIds: number[];

  test.beforeEach(() => {
    createdPostIds = [];
  });

  test.afterEach(async ({ authedRequest }) => {
    const posts = new PostsService(authedRequest);
    for (const id of createdPostIds) {
      await posts.deleteById(id).catch(() => {});
    }
  });

  test("TC10 - DELETE /posts/{id} for non-existent id - 404 {message:'Resource not found'}", async ({
    authedRequest,
  }) => {
    // Reuses the same 99999999 sentinel as the parent-existence TCs in
    // posts-validation. EP class: target does not exist (never created).
    const posts = new PostsService(authedRequest);
    const res = await posts.deleteById(99999999);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ message: "Resource not found" });
  });

  test("TC11 - DELETE /posts/{id} idempotency: second DELETE on same id - 404 (state transition exists -> deleted -> still-deleted)", async ({
    authedRequest,
  }) => {
    // State-transition: state `exists` -> first DELETE (204) -> state `deleted`
    // -> second DELETE (404). The RFC says DELETE is idempotent in terms of
    // server STATE (resource is gone either way), not response code. GoRest's
    // 204-then-404 pattern is RFC-compliant and matches conventional REST.
    const posts = new PostsService(authedRequest);
    const payload = { title: randomTitle(), body: randomBody() };
    const createRes = await posts.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdPostIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    const firstDel = await posts.deleteById(createBody.id);
    expect(firstDel.status()).toBe(204);
    expect(await firstDel.text()).toBe("");

    const secondDel = await posts.deleteById(createBody.id);
    expect(secondDel.status()).toBe(404);
    const body = await secondDel.json();
    expect(body).toEqual({ message: "Resource not found" });
  });
});
