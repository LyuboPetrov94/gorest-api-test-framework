import { test, expect } from "../../../fixtures";
import { CommentsService } from "../../../services/CommentsService";
import { createParentPost } from "../../../helpers/createParentPost";
import { randomEmail, randomString } from "../../../helpers/data";

// All 422-array assertions use `expect(body).toContainEqual(...)` - set
// semantics, no order coupling. See "GoRest aggregates ALL validation errors"
// gotcha in tests/api/CLAUDE.md.

function randomName(): string {
  return `Commenter ${randomString(8)}`;
}

function randomCommentBody(): string {
  return `Comment body ${randomString(16)}. Lorem ipsum dolor sit amet.`;
}

// A path id that does not (and will not) exist in any token's slice. Used by
// the parent-existence TCs to drive the validation layer's "must exist"
// response. The error field is `"post"` (the model relation name), NOT
// `"post_id"` (the URL param) - see comments-discovery gotcha.
const BOGUS_POST_ID = 99999999;

// File-scope parent post (under a parent user), shared across all describe
// blocks for the worker. `beforeAll` is worker-scoped, so one parent per
// worker. Per-token isolation makes this safe across parallel workers. Cleanup
// via `parentCleanup` in afterAll deletes the parent user, cascade-reaping the
// post and any surviving child comments.
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

test.describe("Comments - validation - name blank", () => {
  // No createdCommentIds - TC expects 422 (no resource created).

  test("TC01 - POST empty name - 422 'can't be blank'", async ({
    authedRequest,
  }) => {
    const comments = new CommentsService(authedRequest);
    const payload = {
      name: "",
      email: randomEmail(),
      body: randomCommentBody(),
    };
    const res = await comments.create(parentPostId, payload);
    expect(res.status()).toBe(422);
    const body = await res.json();
    // Empty string is the representative for the blank EP class - missing key
    // and whitespace-only collapse to the same response (see "Blank EP class
    // collapses" gotcha). One TC per class is enough; the equivalence is
    // documented, not multiplied.
    expect(body).toContainEqual({ field: "name", message: "can't be blank" });
  });
});

test.describe("Comments - validation - name length BVA (lower + upper bounds)", () => {
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

  // 5-point BVA. Length 0 is excluded (it IS the blank EP class, covered by
  // TC01). Per root CLAUDE.md BVA rule: keep all points even when "at" and
  // "above" produce the same outcome - the points document the boundary's
  // *shape*. Lengths 1 and 2 both pass (201); both kept to hedge against silent
  // off-by-one regressions. Bound is 1-200, same as user.name and post.title.
  const nameBVA = [
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

  for (const { tc, length, status, errorMessage } of nameBVA) {
    test(`${tc} - POST name length ${length}`, async ({ authedRequest }) => {
      const comments = new CommentsService(authedRequest);
      const payload = {
        name: randomString(length),
        email: randomEmail(),
        body: randomCommentBody(),
      };
      const res = await comments.create(parentPostId, payload);
      const body = await res.json();
      if (status === 201 && body?.id) createdCommentIds.push(body.id);

      expect(res.status()).toBe(status);
      if (errorMessage !== null) {
        // eslint-disable-next-line playwright/no-conditional-expect -- status asserted unconditionally above; only the failure-row message is guarded
        expect(body).toContainEqual({ field: "name", message: errorMessage });
      }
    });
  }
});

test.describe("Comments - validation - email (blank + invalid format)", () => {
  // `email` is the new field this resource introduces. The validator is the
  // same one Users uses (users-validation TC01-03 pinned the format partition
  // exhaustively). Comment coverage repeats the 3 invalid-format reps for
  // portfolio defense-in-depth AND pins the comment-specific blank behavior:
  // a blank email returns a TWO-PART message "can't be blank, is invalid"
  // (blank + format failure combined), distinct from name/body's single-part
  // "can't be blank". See comments-discovery gotcha.

  test("TC07 - POST empty email - 422 'can't be blank, is invalid' (two-part message)", async ({
    authedRequest,
  }) => {
    const comments = new CommentsService(authedRequest);
    const payload = {
      name: randomName(),
      email: "",
      body: randomCommentBody(),
    };
    const res = await comments.create(parentPostId, payload);
    expect(res.status()).toBe(422);
    const body = await res.json();
    // Pin the exact two-part message - do NOT collapse it to "can't be blank".
    expect(body).toContainEqual({
      field: "email",
      message: "can't be blank, is invalid",
    });
  });

  // 3 invalid-format representatives, mirroring users-validation TC01-03. All
  // return the same single-part `is invalid`. Distinct EP sub-classes of
  // "malformed": no @, no domain, no local part.
  const invalidEmails = [
    { tc: "TC08", email: "notanemail", note: "no @ symbol" },
    { tc: "TC09", email: "user@", note: "no domain" },
    { tc: "TC10", email: "@example.com", note: "no local part" },
  ];

  for (const { tc, email, note } of invalidEmails) {
    test(`${tc} - POST invalid email (${note}) - 422 'is invalid'`, async ({
      authedRequest,
    }) => {
      const comments = new CommentsService(authedRequest);
      const payload = { name: randomName(), email, body: randomCommentBody() };
      const res = await comments.create(parentPostId, payload);
      expect(res.status()).toBe(422);
      const body = await res.json();
      expect(body).toContainEqual({ field: "email", message: "is invalid" });
    });
  }
});

test.describe("Comments - validation - body blank", () => {
  test("TC11 - POST empty body - 422 'can't be blank'", async ({
    authedRequest,
  }) => {
    const comments = new CommentsService(authedRequest);
    const payload = { name: randomName(), email: randomEmail(), body: "" };
    const res = await comments.create(parentPostId, payload);
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body).toContainEqual({ field: "body", message: "can't be blank" });
  });
});

test.describe("Comments - validation - body length BVA (lower + upper bounds)", () => {
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

  // Same 5-point BVA pattern as name (length 0 excluded - blank EP class).
  // Upper bound is 500 for body (same as post.body).
  const bodyBVA = [
    { tc: "TC12", length: 1, status: 201, errorMessage: null },
    { tc: "TC13", length: 2, status: 201, errorMessage: null },
    { tc: "TC14", length: 499, status: 201, errorMessage: null },
    { tc: "TC15", length: 500, status: 201, errorMessage: null },
    {
      tc: "TC16",
      length: 501,
      status: 422,
      errorMessage: "is too long (maximum is 500 characters)",
    },
  ];

  for (const { tc, length, status, errorMessage } of bodyBVA) {
    test(`${tc} - POST body length ${length}`, async ({ authedRequest }) => {
      const comments = new CommentsService(authedRequest);
      const payload = {
        name: randomName(),
        email: randomEmail(),
        body: randomString(length),
      };
      const res = await comments.create(parentPostId, payload);
      const body = await res.json();
      if (status === 201 && body?.id) createdCommentIds.push(body.id);

      expect(res.status()).toBe(status);
      if (errorMessage !== null) {
        // eslint-disable-next-line playwright/no-conditional-expect -- status asserted unconditionally above; only the failure-row message is guarded
        expect(body).toContainEqual({ field: "body", message: errorMessage });
      }
    });
  }
});

test.describe("Comments - validation - error aggregation", () => {
  test("TC17 - POST {name:'', email:'', body:''} - 422 with ALL THREE errors aggregated (set semantics)", async ({
    authedRequest,
  }) => {
    const comments = new CommentsService(authedRequest);
    const payload = { name: "", email: "", body: "" };
    const res = await comments.create(parentPostId, payload);
    expect(res.status()).toBe(422);
    const body = await res.json();

    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);

    // SET semantics - sort field names to compare order-independently. Pinning
    // server-side declaration order would couple tests to model internals.
    const errorFields = body.map((e: { field: string }) => e.field).sort();
    expect(errorFields).toEqual(["body", "email", "name"]);

    // Spot-check each error message - proves aggregation isn't dropping or
    // mutating individual field errors. Also doubles as evidence that the
    // email-blank path lands the two-part message even when aggregated.
    expect(body).toContainEqual({ field: "name", message: "can't be blank" });
    expect(body).toContainEqual({
      field: "email",
      message: "can't be blank, is invalid",
    });
    expect(body).toContainEqual({ field: "body", message: "can't be blank" });
  });
});

test.describe("Comments - validation - verb parity (PATCH/PUT use POST validators)", () => {
  // Name is the single representative field for verb-parity. The property
  // tested is "PATCH and PUT reuse POST validators on sent fields", which is a
  // field-agnostic mechanism - if it fires for name, it fires for email/body
  // too. Mirrors posts-validation TC14/TC15 (title only).
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

  test("TC18 - PATCH with empty name - 422 (PATCH reuses POST validators)", async ({
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

    const patchRes = await comments.patch(createBody.id, { name: "" });
    expect(patchRes.status()).toBe(422);
    const body = await patchRes.json();
    expect(body).toContainEqual({ field: "name", message: "can't be blank" });
  });

  test("TC19 - PUT with empty name - 422 (PUT is loose, but sent fields ARE validated)", async ({
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

    // Raw PUT with only name to test sent-field validation in isolation.
    // CommentsService.update requires UpdateCommentPayload (all 4 fields per
    // defensive TS convention); bypassing for the negative test, same pattern
    // as posts-validation TC15. Demonstrates that PUT being loose (accepts
    // partials, preserves unsent fields) does NOT exempt sent fields from
    // validation.
    const putRes = await authedRequest.put(
      `/public/v2/comments/${createBody.id}`,
      { data: { name: "" } },
    );
    expect(putRes.status()).toBe(422);
    const body = await putRes.json();
    expect(body).toContainEqual({ field: "name", message: "can't be blank" });
  });
});

// Parent-existence TCs. The server returns the same [{field, message}] 422
// envelope as field validators, so the structural family is validation. TC20
// uses BOGUS_POST_ID; TC21 creates and deletes an ISOLATED per-test parent so
// the file-scope `parentPostId` stays valid for other describe blocks.

test.describe("Comments - validation - parent existence", () => {
  // createdCommentIds needed by TC22/TC23 which create a real comment and then
  // try to mutate it with a bogus post_id. TC20/TC21 don't create anything
  // (422 before any record persists) so they push nothing.
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

  test("TC20 - POST /posts/{bogus_post_id}/comments - 422 with [{field:'post',message:'must exist'}]", async ({
    authedRequest,
  }) => {
    const comments = new CommentsService(authedRequest);
    const payload = {
      name: randomName(),
      email: randomEmail(),
      body: randomCommentBody(),
    };
    const res = await comments.create(BOGUS_POST_ID, payload);

    expect(res.status()).toBe(422);
    const body = await res.json();
    // Pin the exact envelope - `field: "post"` (singular, the model relation
    // name), NOT `"post_id"` (the URL param name). Gotcha-pinned.
    expect(body).toEqual([{ field: "post", message: "must exist" }]);
  });

  test("TC21 - POST /posts/{deleted_post_id}/comments (state transition) - same 422 as bogus parent", async ({
    authedRequest,
  }) => {
    // State-transition variant of TC20: create a real parent post, delete it
    // (via its user's cascade), then POST a comment to its id. Asserts that
    // bogus-parent and deleted-parent produce the same observable contract.
    //
    // Uses an ISOLATED per-test parent rather than the file-scope `parentPostId`,
    // because this TC deliberately deletes its parent. The shared parent stays
    // alive for any TCs in this file that depend on it.
    const isolatedParent = await createParentPost(authedRequest);
    const deletedPostId = isolatedParent.postId;
    await isolatedParent.cleanup();

    const comments = new CommentsService(authedRequest);
    const payload = {
      name: randomName(),
      email: randomEmail(),
      body: randomCommentBody(),
    };
    const res = await comments.create(deletedPostId, payload);

    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body).toEqual([{ field: "post", message: "must exist" }]);
  });

  // TC22/TC23 prove the parent-existence validator fires on PATCH and PUT too.
  // Same envelope as TC20/TC21 (POST coverage). The validator is verb-agnostic
  // (one rule, three write verbs) - mirrors posts-validation TC18/TC19.

  test("TC22 - PATCH /comments/{id} with bogus post_id - 422 [{field:'post',message:'must exist'}]", async ({
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

    const patchRes = await comments.patch(createBody.id, {
      post_id: BOGUS_POST_ID,
    });
    expect(patchRes.status()).toBe(422);
    const body = await patchRes.json();
    expect(body).toEqual([{ field: "post", message: "must exist" }]);
  });

  test("TC23 - PUT /comments/{id} with bogus post_id (full payload) - 422 same envelope", async ({
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

    const replacement = {
      post_id: BOGUS_POST_ID,
      name: randomName(),
      email: randomEmail(),
      body: randomCommentBody(),
    };
    const putRes = await comments.update(createBody.id, replacement);
    expect(putRes.status()).toBe(422);
    const body = await putRes.json();
    expect(body).toEqual([{ field: "post", message: "must exist" }]);
  });
});
