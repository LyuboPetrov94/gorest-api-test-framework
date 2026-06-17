import { test, expect, BASE_URL } from "../../../fixtures";
import { TodosService } from "../../../services/TodosService";
import { request as playwrightRequest } from "@playwright/test";
import { createParentUser } from "../../../helpers/createParentUser";
import { randomString } from "../../../helpers/data";

function randomTitle(): string {
  return `Todo title ${randomString(8)}`;
}

// `due_on` accepts a plain date and normalizes it to IST midnight on read.
// Pinning the exact normalized form (incl. the +05:30 offset) is deliberate
// defense-in-depth: if GoRest ever changes its server timezone or date
// handling, the contract fails loudly. See tests/api/CLAUDE.md "due_on" gotcha.
const DUE_ON_INPUT = "2026-07-01";
const DUE_ON_NORMALIZED = "2026-07-01T00:00:00.000+05:30";

// File-scope shared parent user, matching posts-crud's lifecycle. No remaining
// TC in this file mutates the parent (parent-not-found TCs live in
// todos-validation), so a single parent per worker is safe and cheap. afterAll
// cleanup reaps the parent and - via the cascade-delete gotcha - any leaked
// child todos.
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

test.describe("Todos - CRUD happy paths", () => {
  let createdTodoIds: number[];

  test.beforeEach(() => {
    createdTodoIds = [];
  });

  test.afterEach(async ({ authedRequest }) => {
    const todos = new TodosService(authedRequest);
    // Per-todo cleanup is defensive belt-and-braces - afterAll's parent
    // cleanup cascade-deletes children too (gotcha), but explicit per-id
    // cleanup keeps state legible if cascade behavior ever changes.
    // `.catch(() => {})` handles already-deleted (TC09's state-transition
    // deletes its own todo).
    for (const id of createdTodoIds) {
      await todos.deleteById(id).catch(() => {});
    }
  });

  test("TC01 - GET /todos (anonymous) - 200, no rate-limit headers, 5-field shape, default page 10", async () => {
    // Anonymous context - no Authorization header. Per the gotcha catalogue,
    // GoRest's GET-list endpoints are publicly accessible without a token.
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const todos = new TodosService(ctx);
      const res = await todos.listAll();

      expect(res.status()).toBe(200);

      // Anonymous = no rate-limit headers (gotcha)
      const headers = res.headers();
      expect(headers["x-ratelimit-limit"]).toBeUndefined();
      expect(headers["x-ratelimit-remaining"]).toBeUndefined();

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(10); // default page size

      // Shape lock: exactly 5 keys, no extras. `due_on` is the distinguishing
      // field vs Posts; `status` is the enum.
      const first = body[0];
      expect(Object.keys(first).sort()).toEqual([
        "due_on",
        "id",
        "status",
        "title",
        "user_id",
      ]);

      // Types - id and user_id are Number per gotcha (not String, not regex)
      expect(first.id).toEqual(expect.any(Number));
      expect(first.id).toBeGreaterThan(0);
      expect(first.user_id).toEqual(expect.any(Number));
      expect(first.user_id).toBeGreaterThan(0);
      expect(typeof first.title).toBe("string");
      // status is the pending/completed enum
      expect(["pending", "completed"]).toContain(first.status);
      // due_on is either an ISO string or null (nullable date field)
      expect(first.due_on === null || typeof first.due_on === "string").toBe(
        true,
      );
    } finally {
      await ctx.dispose();
    }
  });

  test("TC02 - GET /todos (authed) - same body shape PLUS x-ratelimit-* headers", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const res = await todos.listAll();

    expect(res.status()).toBe(200);

    // Rate-limit headers present on authed requests (gotcha)
    const headers = res.headers();
    const limit = Number(headers["x-ratelimit-limit"]);
    const remaining = Number(headers["x-ratelimit-remaining"]);
    const reset = Number(headers["x-ratelimit-reset"]);

    expect(Number.isFinite(limit)).toBe(true);
    expect(Number.isFinite(remaining)).toBe(true);
    expect(Number.isFinite(reset)).toBe(true);
    expect(limit).toBe(300); // pinned per rate-limit gotcha
    // Bounds-only assertion - the token bucket refills continuously, so an
    // exact decrement is non-deterministic (gotcha). remaining <= limit always.
    expect(remaining).toBeLessThanOrEqual(limit);

    // Body shape parity with TC01
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(Object.keys(body[0]).sort()).toEqual([
      "due_on",
      "id",
      "status",
      "title",
      "user_id",
    ]);
  });

  test("TC03 - POST /users/{user_id}/todos - 201 with server-assigned id, body echoes payload, user_id matches path, due_on normalized", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const payload = {
      title: randomTitle(),
      status: "pending",
      due_on: DUE_ON_INPUT,
    };

    const res = await todos.create(parentUserId, payload);
    const body = await res.json();

    // Push for cleanup BEFORE assertions - a failing assertion below should
    // still leave a deleteable id behind.
    if (body?.id) createdTodoIds.push(body.id);

    expect(res.status()).toBe(201);
    expect(res.headers()["content-type"]).toContain("application/json");

    expect(body.id).toEqual(expect.any(Number));
    expect(body.id).toBeGreaterThan(0);
    expect(body.title).toBe(payload.title);
    expect(body.status).toBe(payload.status);
    // due_on: plain date input normalized to IST midnight on the response
    expect(body.due_on).toBe(DUE_ON_NORMALIZED);
    // Parentage contract: response user_id equals the path user_id
    expect(body.user_id).toBe(parentUserId);
  });

  test("TC04 - GET /todos/{id} (authed) - round-trip identity (create then fetch returns equal body)", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const payload = {
      title: randomTitle(),
      status: "completed",
      due_on: DUE_ON_INPUT,
    };
    const createRes = await todos.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    const getRes = await todos.getById(createBody.id);
    expect(getRes.status()).toBe(200);
    const getBody = await getRes.json();

    // Deep equality - GoRest returns the same shape from GET as from POST
    expect(getBody).toEqual(createBody);
  });

  // TC05 + TC06 note: GoRest's PUT is loose like Users/Posts (behaves like
  // PATCH - accepts partials, preserves unsent fields). Per the gotcha
  // catalogue. Both TCs exist for verb-coverage; they do not prove distinct
  // semantics on this API.

  test("TC05 - PUT /todos/{id} - full replace: title, status and due_on change, id and user_id preserved", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const original = {
      title: randomTitle(),
      status: "pending",
      due_on: DUE_ON_INPUT,
    };
    const createRes = await todos.create(parentUserId, original);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);

    const replacement = {
      user_id: parentUserId,
      title: randomTitle(),
      status: "completed",
      due_on: null,
    };
    const putRes = await todos.update(createBody.id, replacement);
    expect(putRes.status()).toBe(200);

    const putBody = await putRes.json();
    expect(putBody.id).toBe(createBody.id); // id preserved across replace
    expect(putBody.user_id).toBe(parentUserId); // user_id preserved
    expect(putBody.title).toBe(replacement.title);
    expect(putBody.status).toBe(replacement.status);
    expect(putBody.due_on).toBeNull(); // explicitly nulled in the replacement
  });

  test("TC06 - PATCH /todos/{id} - partial update: title changes, status and due_on unchanged", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const original = {
      title: randomTitle(),
      status: "pending",
      due_on: DUE_ON_INPUT,
    };
    const createRes = await todos.create(parentUserId, original);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);

    const newTitle = randomTitle();
    const patchRes = await todos.patch(createBody.id, { title: newTitle });
    expect(patchRes.status()).toBe(200);

    const patchBody = await patchRes.json();
    expect(patchBody.id).toBe(createBody.id);
    expect(patchBody.user_id).toBe(parentUserId);
    expect(patchBody.title).toBe(newTitle); // changed
    // The partial-update property: unsent fields preserve original values
    expect(patchBody.status).toBe(original.status);
    expect(patchBody.due_on).toBe(DUE_ON_NORMALIZED);
  });

  test("TC07 - PATCH /todos/{id} due_on to a new date (future then past) - 200, re-normalized to IST, persists; no temporal constraint", async ({
    authedRequest,
  }) => {
    // due_on is an updatable field. This pins normalization on the UPDATE path
    // (TC03 only pins it on create) and documents that GoRest applies NO
    // past/future validation - a due date can be moved forward to a future date
    // or backward to a past one, both accepted and re-normalized to IST midnight
    // (probed 2026-06-05). due_on remains optional on update; this TC sends it
    // explicitly because changing it is the property under test.
    const todos = new TodosService(authedRequest);
    const payload = {
      title: randomTitle(),
      status: "pending",
      due_on: DUE_ON_INPUT,
    };
    const createRes = await todos.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);
    expect(createRes.status()).toBe(201);
    expect(createBody.due_on).toBe(DUE_ON_NORMALIZED); // precondition: date set

    // Move the due date FORWARD to a new future date - re-normalized to IST
    const futurePatch = await todos.patch(createBody.id, {
      due_on: "2026-09-30",
    });
    expect(futurePatch.status()).toBe(200);
    expect((await futurePatch.json()).due_on).toBe(
      "2026-09-30T00:00:00.000+05:30",
    );

    // Move it BACKWARD to a past date - accepted, no temporal constraint
    const pastPatch = await todos.patch(createBody.id, {
      due_on: "2020-01-15",
    });
    expect(pastPatch.status()).toBe(200);
    expect((await pastPatch.json()).due_on).toBe(
      "2020-01-15T00:00:00.000+05:30",
    );

    // Persistence check - the last update is durable, not just echoed
    const getRes = await todos.getById(createBody.id);
    expect((await getRes.json()).due_on).toBe("2020-01-15T00:00:00.000+05:30");
  });

  test("TC08 - PATCH /todos/{id} {due_on: null} - 200, due date removed (cleared to null), persists", async ({
    authedRequest,
  }) => {
    // Removing the due date: PATCH with an explicit null clears the field - it
    // is NOT treated as "no change" (probed 2026-06-05). due_on is nullable, so
    // this is the canonical "unset the due date" operation. An empty string
    // behaves identically (collapses to null via the no-format-validation
    // coercion), but null is the explicit, type-honest form.
    const todos = new TodosService(authedRequest);
    const payload = {
      title: randomTitle(),
      status: "pending",
      due_on: DUE_ON_INPUT,
    };
    const createRes = await todos.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);
    expect(createRes.status()).toBe(201);
    expect(createBody.due_on).toBe(DUE_ON_NORMALIZED); // precondition: date set

    const patchRes = await todos.patch(createBody.id, { due_on: null });
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).due_on).toBeNull();

    // Removal is durable, not just echoed
    const getRes = await todos.getById(createBody.id);
    expect((await getRes.json()).due_on).toBeNull();
  });

  test("TC09 - DELETE /todos/{id} state transition: 204 then 404 on follow-up GET", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const payload = {
      title: randomTitle(),
      status: "pending",
    };
    const createRes = await todos.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);

    const delRes = await todos.deleteById(createBody.id);
    expect(delRes.status()).toBe(204);
    // 204 = No Content; assert the body is genuinely empty (not just JSON-empty)
    const delText = await delRes.text();
    expect(delText).toBe("");

    // State transition verification: GET should now 404 with JSON envelope
    const getRes = await todos.getById(createBody.id);
    expect(getRes.status()).toBe(404);
    const getBody = await getRes.json();
    expect(getBody).toEqual({ message: "Resource not found" });
  });

  test("TC10 - GET /todos pagination headers contract: pages == ceil(total / limit)", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const res = await todos.listAll();
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
    // users-crud / posts-crud TC08.
    expect(pages).toBe(Math.ceil(total / limit));

    // Link headers - `x-links-previous` is empty string on page 1, don't assert it
    expect(headers["x-links-current"]).toMatch(/[?&]page=1\b/);
    expect(headers["x-links-next"]).toBeTruthy();
  });

  test("TC11 - PATCH /todos/{id} {user_id: <other>} - 200, todo reparented to new user", async ({
    authedRequest,
  }) => {
    // Mutability contract: `user_id` is an updatable foreign key on PATCH/PUT
    // (probed 2026-06-05, same as Posts/Comments). PATCH chosen as the single
    // representative since the property is verb-agnostic. Parent-existence
    // validation on bogus user_id for both verbs is covered in
    // todos-validation TC18/TC19.
    const todos = new TodosService(authedRequest);
    const payload = {
      title: randomTitle(),
      status: "pending",
    };
    const createRes = await todos.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    // Second parent owned by this TC - cleaned in `finally` so it's removed
    // even if assertions fail. After the PATCH reparents, this user becomes
    // the new parent; its cleanup cascade-deletes the todo too.
    const otherParent = await createParentUser(authedRequest);
    try {
      const patchRes = await todos.patch(createBody.id, {
        user_id: otherParent.id,
      });
      expect(patchRes.status()).toBe(200);

      const patchBody = await patchRes.json();
      expect(patchBody.id).toBe(createBody.id);
      // Mutability: response shows the NEW user_id, not the original
      expect(patchBody.user_id).toBe(otherParent.id);
      expect(patchBody.user_id).not.toBe(parentUserId);
      // PATCH partial: title/status preserved since only user_id was sent
      expect(patchBody.title).toBe(payload.title);
      expect(patchBody.status).toBe(payload.status);
    } finally {
      await otherParent.cleanup();
    }
  });
});

test.describe("Todos - status state transition", () => {
  // The status field is a 2-state machine (pending <-> completed). These two
  // TCs cover both valid edges (0-switch coverage). GoRest enforces no workflow
  // constraint - status is a freely-reversible enum (probed 2026-06-05). The
  // invalid-event edge (status -> bogus value, rejected + state preserved) is
  // covered in todos-validation TC14.
  let createdTodoIds: number[];

  test.beforeEach(() => {
    createdTodoIds = [];
  });

  test.afterEach(async ({ authedRequest }) => {
    const todos = new TodosService(authedRequest);
    for (const id of createdTodoIds) {
      await todos.deleteById(id).catch(() => {});
    }
  });

  test("TC12 - PATCH status pending -> completed (forward edge), flip persists on GET-by-id", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const payload = { title: randomTitle(), status: "pending" };
    const createRes = await todos.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);
    expect(createRes.status()).toBe(201);
    expect(createBody.status).toBe(payload.status);

    const patchRes = await todos.patch(createBody.id, { status: "completed" });
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).status).toBe("completed");

    // Persistence check - the transition is durable, not just echoed
    const getRes = await todos.getById(createBody.id);
    expect((await getRes.json()).status).toBe("completed");
  });

  test("TC13 - PATCH status completed -> pending (backward edge), no workflow lock", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const payload = { title: randomTitle(), status: "completed" };
    const createRes = await todos.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);
    expect(createRes.status()).toBe(201);
    expect(createBody.status).toBe(payload.status);

    // The reverse edge - proves GoRest does not lock a completed todo
    const patchRes = await todos.patch(createBody.id, { status: "pending" });
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).status).toBe("pending");

    const getRes = await todos.getById(createBody.id);
    expect((await getRes.json()).status).toBe("pending");
  });
});

test.describe("Todos - DELETE state transitions (negatives)", () => {
  // Companion to TC09's happy-path DELETE. TC09 covers `exists -> deleted`;
  // these two cover the remaining target states: `never existed` and
  // `already deleted`. Both produce 404 with the same envelope as a GET on a
  // non-existent id.
  let createdTodoIds: number[];

  test.beforeEach(() => {
    createdTodoIds = [];
  });

  test.afterEach(async ({ authedRequest }) => {
    const todos = new TodosService(authedRequest);
    for (const id of createdTodoIds) {
      await todos.deleteById(id).catch(() => {});
    }
  });

  test("TC14 - DELETE /todos/{id} for non-existent id - 404 {message:'Resource not found'}", async ({
    authedRequest,
  }) => {
    // Reuses the same 99999999 sentinel as the parent-existence TCs in
    // todos-validation. EP class: target does not exist (never created).
    const todos = new TodosService(authedRequest);
    const res = await todos.deleteById(99999999);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ message: "Resource not found" });
  });

  test("TC15 - DELETE /todos/{id} idempotency: second DELETE on same id - 404 (state transition exists -> deleted -> still-deleted)", async ({
    authedRequest,
  }) => {
    // State-transition: state `exists` -> first DELETE (204) -> state `deleted`
    // -> second DELETE (404). The RFC says DELETE is idempotent in terms of
    // server STATE (resource is gone either way), not response code. GoRest's
    // 204-then-404 pattern is RFC-compliant and matches conventional REST.
    const todos = new TodosService(authedRequest);
    const payload = { title: randomTitle(), status: "pending" };
    const createRes = await todos.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    const firstDel = await todos.deleteById(createBody.id);
    expect(firstDel.status()).toBe(204);
    expect(await firstDel.text()).toBe("");

    const secondDel = await todos.deleteById(createBody.id);
    expect(secondDel.status()).toBe(404);
    const body = await secondDel.json();
    expect(body).toEqual({ message: "Resource not found" });
  });
});
