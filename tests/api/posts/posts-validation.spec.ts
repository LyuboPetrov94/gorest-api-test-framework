import { test, expect } from "../../../fixtures";
import { PostsService } from "../../../services/PostsService";
import { createParentUser } from "../../../helpers/createParentUser";
import { randomString } from "../../../helpers/data";

// All 422-array assertions use `expect(body).toContainEqual(...)` - set
// semantics, no order coupling. See "GoRest aggregates ALL validation errors"
// gotcha in tests/api/CLAUDE.md.

function randomTitle(): string {
  return `Post title ${randomString(8)}`;
}

function randomBody(): string {
  return `Post body ${randomString(16)}. Lorem ipsum dolor sit amet.`;
}

// A path id that does not (and will not) exist in any token's slice. Used by
// the parent-existence TCs below to drive the validation layer's "must exist"
// response. See tests/api/CLAUDE.md "POST .../posts with non-existent ...
// parent" gotcha for the 422 envelope contract.
const BOGUS_USER_ID = 99999999;

// File-scope parent user, shared across all describe blocks for the worker.
// `beforeAll` is worker-scoped under Playwright worker fixtures, so we get one
// parent per worker. Per-token data isolation makes this safe across parallel
// workers. Single parent re-used across all TCs (no observable cross-TC
// interference - validation TCs that succeed clean their own posts; failing
// TCs create nothing). Cleanup via `parentCleanup` in afterAll also reaps any
// surviving child posts (cascade-delete gotcha).
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

test.describe("Posts - validation - title blank", () => {
  // No createdPostIds - TC expects 422 (no resource created).

  test("TC01 - POST empty title - 422 'can't be blank'", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const payload = { title: "", body: randomBody() };
    const res = await posts.create(parentUserId, payload);
    expect(res.status()).toBe(422);
    const body = await res.json();
    // Empty string is the representative for the blank EP class - missing key
    // and whitespace-only collapse to the same response (see "Blank EP class
    // collapses" gotcha). One TC per class is enough; the equivalence is
    // documented, not multiplied.
    expect(body).toContainEqual({ field: "title", message: "can't be blank" });
  });
});

test.describe("Posts - validation - title length BVA (lower + upper bounds)", () => {
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

  // 5-point BVA. Length 0 is excluded (it IS the blank EP class, covered by
  // TC01). Per root CLAUDE.md BVA rule: keep all points even when "at" and
  // "above" produce the same outcome - the points document the boundary's
  // *shape*, not just outcome diversity. Length 1 and 2 both pass (201); both
  // kept to hedge against silent off-by-one regressions if GoRest ever ratchets
  // the minimum upward.
  const titleBVA = [
    { tc: "TC02", length: 1, status: 201, errorMessage: null },
    { tc: "TC03", length: 2, status: 201, errorMessage: null },
    { tc: "TC04", length: 199, status: 201, errorMessage: null },
    { tc: "TC05", length: 200, status: 201, errorMessage: null },
    {
      tc: "TC06",
      length: 201,
      status: 422,
      errorMessage: "is too long (maximum is 200 characters)",
    },
  ];

  for (const { tc, length, status, errorMessage } of titleBVA) {
    test(`${tc} - POST title length ${length}`, async ({ authedRequest }) => {
      const posts = new PostsService(authedRequest);
      const payload = { title: randomString(length), body: randomBody() };
      const res = await posts.create(parentUserId, payload);
      const body = await res.json();
      if (status === 201 && body?.id) createdPostIds.push(body.id);

      expect(res.status()).toBe(status);
      if (errorMessage !== null) {
        expect(body).toContainEqual({ field: "title", message: errorMessage });
      }
    });
  }
});

test.describe("Posts - validation - body blank", () => {
  test("TC07 - POST empty body - 422 'can't be blank'", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const payload = { title: randomTitle(), body: "" };
    const res = await posts.create(parentUserId, payload);
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body).toContainEqual({ field: "body", message: "can't be blank" });
  });
});

test.describe("Posts - validation - body length BVA (lower + upper bounds)", () => {
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

  // Same 5-point BVA pattern as title (length 0 excluded - blank EP class).
  // Upper bound is 500 for body (vs 200 for title and user.name).
  const bodyBVA = [
    { tc: "TC08", length: 1, status: 201, errorMessage: null },
    { tc: "TC09", length: 2, status: 201, errorMessage: null },
    { tc: "TC10", length: 499, status: 201, errorMessage: null },
    { tc: "TC11", length: 500, status: 201, errorMessage: null },
    {
      tc: "TC12",
      length: 501,
      status: 422,
      errorMessage: "is too long (maximum is 500 characters)",
    },
  ];

  for (const { tc, length, status, errorMessage } of bodyBVA) {
    test(`${tc} - POST body length ${length}`, async ({ authedRequest }) => {
      const posts = new PostsService(authedRequest);
      const payload = { title: randomTitle(), body: randomString(length) };
      const res = await posts.create(parentUserId, payload);
      const body = await res.json();
      if (status === 201 && body?.id) createdPostIds.push(body.id);

      expect(res.status()).toBe(status);
      if (errorMessage !== null) {
        expect(body).toContainEqual({ field: "body", message: errorMessage });
      }
    });
  }
});

test.describe("Posts - validation - error aggregation", () => {
  test("TC13 - POST {title:'', body:''} - 422 with BOTH errors aggregated (set semantics)", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const payload = { title: "", body: "" };
    const res = await posts.create(parentUserId, payload);
    expect(res.status()).toBe(422);
    const body = await res.json();

    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);

    // SET semantics - sort field names to compare order-independently. Pinning
    // server-side declaration order would couple tests to model internals.
    const errorFields = body.map((e: { field: string }) => e.field).sort();
    expect(errorFields).toEqual(["body", "title"]);

    // Spot-check each error message - proves aggregation isn't dropping or
    // mutating individual field errors. toContainEqual is set-membership.
    expect(body).toContainEqual({ field: "title", message: "can't be blank" });
    expect(body).toContainEqual({ field: "body", message: "can't be blank" });
  });
});

test.describe("Posts - validation - verb parity (PATCH/PUT use POST validators)", () => {
  // Title is the single representative field for verb-parity. The property
  // tested is "PATCH and PUT reuse POST validators on sent fields", which is a
  // field-agnostic mechanism - if it fires for title, it fires for body too.
  // Mirrors users-validation TC15/TC16 (gender only, not name/email/status).
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

  test("TC14 - PATCH with empty title - 422 (PATCH reuses POST validators)", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const payload = { title: randomTitle(), body: randomBody() };
    const createRes = await posts.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdPostIds.push(createBody.id);

    const patchRes = await posts.patch(createBody.id, { title: "" });
    expect(patchRes.status()).toBe(422);
    const body = await patchRes.json();
    expect(body).toContainEqual({ field: "title", message: "can't be blank" });
  });

  test("TC15 - PUT with empty title - 422 (PUT is loose, but sent fields ARE validated)", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const payload = { title: randomTitle(), body: randomBody() };
    const createRes = await posts.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdPostIds.push(createBody.id);

    // Raw PUT with only title to test sent-field validation in isolation.
    // PostsService.update requires UpdatePostPayload (all 3 fields per
    // defensive TS convention); bypassing for the negative test, same pattern
    // as users-validation TC16. Demonstrates that PUT being loose (accepts
    // partials, preserves unsent fields) does NOT exempt sent fields from
    // validation.
    const putRes = await authedRequest.put(
      `/public/v2/posts/${createBody.id}`,
      { data: { title: "" } },
    );
    expect(putRes.status()).toBe(422);
    const body = await putRes.json();
    expect(body).toContainEqual({ field: "title", message: "can't be blank" });
  });
});

// Parent-existence TCs moved here from posts-crud (originally TC09/TC10). The
// server returns the same [{field, message}] 422 envelope as field validators
// (e.g. "title can't be blank"), so the structural family is validation. TC16
// uses BOGUS_USER_ID; TC17 creates and deletes an ISOLATED per-test parent so
// the file-scope `parentUserId` stays valid for other describe blocks if the
// suite is re-ordered.

test.describe("Posts - validation - parent existence", () => {
  // createdPostIds needed by TC18/TC19 which create a real post and then try
  // to mutate it with a bogus user_id. TC16/TC17 don't create anything (422
  // before any record persists) so they push nothing.
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

  test("TC16 - POST /users/{bogus_user_id}/posts - 422 with [{field:'user',message:'must exist'}]", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const payload = { title: randomTitle(), body: randomBody() };
    const res = await posts.create(BOGUS_USER_ID, payload);

    expect(res.status()).toBe(422);
    const body = await res.json();
    // Pin the exact envelope - `field: "user"` (singular, the model relation
    // name), NOT `"user_id"` (the URL param name). Gotcha-pinned.
    expect(body).toEqual([{ field: "user", message: "must exist" }]);
  });

  test("TC17 - POST /users/{deleted_user_id}/posts (state transition) - same 422 as bogus parent", async ({
    authedRequest,
  }) => {
    // State-transition variant of TC16: create a real parent, delete it, then
    // POST to its id. Asserts that bogus-parent and deleted-parent produce the
    // same observable contract - per-token isolation has consumed the prior
    // state by the time the POST arrives.
    //
    // Uses an ISOLATED per-test parent rather than the file-scope `parentUserId`,
    // because this TC deliberately deletes its parent. The shared parent stays
    // alive for any TCs in this file that depend on it.
    const isolatedParent = await createParentUser(authedRequest);
    await isolatedParent.cleanup();

    const posts = new PostsService(authedRequest);
    const payload = { title: randomTitle(), body: randomBody() };
    const res = await posts.create(isolatedParent.id, payload);

    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body).toEqual([{ field: "user", message: "must exist" }]);
  });

  // TC18/TC19 prove the parent-existence validator fires on PATCH and PUT too.
  // Same envelope as TC16/TC17 (POST coverage). The validator is verb-agnostic
  // (one rule, three write verbs) - documented in the "user_id mutability +
  // verb-agnostic validation" gotcha.

  test("TC18 - PATCH /posts/{id} with bogus user_id - 422 [{field:'user',message:'must exist'}]", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const payload = { title: randomTitle(), body: randomBody() };
    const createRes = await posts.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdPostIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    const patchRes = await posts.patch(createBody.id, {
      user_id: BOGUS_USER_ID,
    });
    expect(patchRes.status()).toBe(422);
    const body = await patchRes.json();
    expect(body).toEqual([{ field: "user", message: "must exist" }]);
  });

  test("TC19 - PUT /posts/{id} with bogus user_id (full payload) - 422 same envelope", async ({
    authedRequest,
  }) => {
    const posts = new PostsService(authedRequest);
    const payload = { title: randomTitle(), body: randomBody() };
    const createRes = await posts.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdPostIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    const replacement = {
      user_id: BOGUS_USER_ID,
      title: randomTitle(),
      body: randomBody(),
    };
    const putRes = await posts.update(createBody.id, replacement);
    expect(putRes.status()).toBe(422);
    const body = await putRes.json();
    expect(body).toEqual([{ field: "user", message: "must exist" }]);
  });
});
