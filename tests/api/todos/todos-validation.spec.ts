import { test, expect } from "../../../fixtures";
import { TodosService } from "../../../services/TodosService";
import { createParentUser } from "../../../helpers/createParentUser";
import { randomString } from "../../../helpers/data";

// All 422-array assertions use `expect(body).toContainEqual(...)` - set
// semantics, no order coupling. See "GoRest aggregates ALL validation errors"
// gotcha in tests/api/CLAUDE.md.

function randomTitle(): string {
  return `Todo title ${randomString(8)}`;
}

// The status validator conflates the blank AND invalid-enum cases into a single
// two-part message (unlike title's single-part "can't be blank"). Pinned per
// the "status is a required enum on POST" gotcha. Reused across the blank,
// invalid-enum, aggregation, and verb-parity TCs.
const STATUS_BLANK_MESSAGE = "can't be blank, can be pending or completed";

// A path id that does not (and will not) exist in any token's slice. Used by
// the parent-existence TCs below to drive the validation layer's "must exist"
// response. See tests/api/CLAUDE.md parent-existence gotcha for the envelope.
const BOGUS_USER_ID = 99999999;

// File-scope parent user, shared across all describe blocks for the worker.
// Per-token data isolation makes this safe across parallel workers. TCs that
// succeed clean their own todos; failing/422 TCs create nothing. Cleanup via
// `parentCleanup` in afterAll also reaps any surviving child todos (cascade).
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

test.describe("Todos - validation - title blank", () => {
  // No createdTodoIds - TC expects 422 (no resource created).

  test("TC01 - POST empty title - 422 'can't be blank'", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const payload = { title: "", status: "pending" };
    const res = await todos.create(parentUserId, payload);
    expect(res.status()).toBe(422);
    const body = await res.json();
    // Empty string is the representative for the blank EP class - missing key
    // and whitespace-only collapse to the same response (see "Blank EP class
    // collapses" gotcha). One TC per class is enough.
    expect(body).toContainEqual({ field: "title", message: "can't be blank" });
  });
});

test.describe("Todos - validation - title length BVA (lower + upper bounds)", () => {
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

  // 5-point BVA. Length 0 is excluded (it IS the blank EP class, covered by
  // TC01). Per root CLAUDE.md BVA rule: keep all points even when "at" and
  // "above" produce the same outcome. Title bound is 1-200, same as Posts and
  // user.name. Length 1 and 2 both pass (201); both kept to hedge against
  // silent off-by-one regressions.
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
      const todos = new TodosService(authedRequest);
      const payload = { title: randomString(length), status: "pending" };
      const res = await todos.create(parentUserId, payload);
      const body = await res.json();
      if (status === 201 && body?.id) createdTodoIds.push(body.id);

      expect(res.status()).toBe(status);
      if (errorMessage !== null) {
        expect(body).toContainEqual({ field: "title", message: errorMessage });
      }
    });
  }
});

test.describe("Todos - validation - status enum (required, two-part message)", () => {
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

  test("TC07 - POST with status field omitted - 422 two-part message (status is required)", async ({
    authedRequest,
  }) => {
    // Raw request bypasses TodosService.create (which requires status per type)
    // - same pattern as users-validation TC02's missing-email test. status is
    // REQUIRED on POST (unlike due_on which is optional), so omitting it is a
    // distinct EP class worth pinning.
    const res = await authedRequest.post(
      `/public/v2/users/${parentUserId}/todos`,
      { data: { title: randomTitle() } },
    );
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body).toContainEqual({
      field: "status",
      message: STATUS_BLANK_MESSAGE,
    });
  });

  test("TC08 - POST with empty status '' - 422 two-part (same response as omitted, distinct EP class)", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const payload = { title: randomTitle(), status: "" };
    const res = await todos.create(parentUserId, payload);
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body).toContainEqual({
      field: "status",
      message: STATUS_BLANK_MESSAGE,
    });
  });

  test("TC09 - POST invalid status enum 'in_progress' - 422 (same conflated message as blank)", async ({
    authedRequest,
  }) => {
    // Distinct invalid-enum EP class from the blank cases (TC07/TC08), but the
    // server returns the SAME two-part message - it does not distinguish "blank"
    // from "not in the enum". Documenting the conflation is the point.
    const todos = new TodosService(authedRequest);
    const payload = { title: randomTitle(), status: "in_progress" };
    const res = await todos.create(parentUserId, payload);
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body).toContainEqual({
      field: "status",
      message: STATUS_BLANK_MESSAGE,
    });
  });

  test("TC10 - POST status 'Pending' (case-insensitivity) - 201 + response normalized to 'pending'", async ({
    authedRequest,
  }) => {
    // Server normalizes case (same as users gender/status). Lives in validation
    // because it documents a server-side normalization rule, not a CRUD path.
    const todos = new TodosService(authedRequest);
    const payload = { title: randomTitle(), status: "Pending" };
    const res = await todos.create(parentUserId, payload);
    const body = await res.json();
    if (body?.id) createdTodoIds.push(body.id);

    expect(res.status()).toBe(201);
    expect(body.status).toBe("pending"); // case normalized server-side
  });
});

test.describe("Todos - validation - due_on input handling (lenient coercion + IST normalization)", () => {
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

  test("TC11 - POST garbage due_on 'not-a-date' - 201, silently coerced to null (NO format validation)", async ({
    authedRequest,
  }) => {
    // The standout Todos quirk: due_on has NO format validation. Unlike title
    // (blank/length) and status (enum), an invalid due_on is NOT rejected with
    // a 422 - it is silently swallowed and stored as null. Pinned per the
    // "due_on has no format validation" gotcha. This is a negative-input test
    // whose "correct" outcome is acceptance, so it documents a permissive
    // contract worth knowing about (a real client bug could hide here).
    const todos = new TodosService(authedRequest);
    const payload = {
      title: randomTitle(),
      status: "pending",
      due_on: "not-a-date",
    };
    const res = await todos.create(parentUserId, payload);
    const body = await res.json();
    if (body?.id) createdTodoIds.push(body.id);

    expect(res.status()).toBe(201);
    expect(body.due_on).toBeNull();
  });

  test("TC12 - POST due_on with time-of-day - 201, time preserved and UTC offset converted to IST (timezone normalization)", async ({
    authedRequest,
  }) => {
    // due_on stores a full timestamp normalized to the IST (+05:30) timezone
    // (probed 2026-06-05). Two assertions pin the contract: (1) a no-offset
    // time-of-day is kept verbatim and assumed IST; (2) a UTC ('Z') input is
    // CONVERTED to the equivalent IST instant (+5:30), proving a real server-
    // side timezone conversion rather than a string tack-on. Lives in
    // validation as a server-side normalization rule, mirroring the gender/
    // status case-insensitivity TCs. Exact IST offsets pinned as defense-in-
    // depth - fails loudly if GoRest ever changes its server timezone.
    const todos = new TodosService(authedRequest);

    // (1) time-of-day, no offset -> kept verbatim, stamped +05:30
    const istPayload = {
      title: randomTitle(),
      status: "pending",
      due_on: "2026-07-01T14:30:00",
    };
    const istRes = await todos.create(parentUserId, istPayload);
    const istBody = await istRes.json();
    if (istBody?.id) createdTodoIds.push(istBody.id);
    expect(istRes.status()).toBe(201);
    expect(istBody.due_on).toBe("2026-07-01T14:30:00.000+05:30");

    // (2) UTC input -> converted to IST (+5:30): 14:30Z becomes 20:00 IST
    const utcPayload = {
      title: randomTitle(),
      status: "pending",
      due_on: "2026-07-01T14:30:00Z",
    };
    const utcRes = await todos.create(parentUserId, utcPayload);
    const utcBody = await utcRes.json();
    if (utcBody?.id) createdTodoIds.push(utcBody.id);
    expect(utcRes.status()).toBe(201);
    expect(utcBody.due_on).toBe("2026-07-01T20:00:00.000+05:30");
  });
});

test.describe("Todos - validation - error aggregation", () => {
  test("TC13 - POST {title:'', status omitted} - 422 with BOTH errors aggregated (set semantics)", async ({
    authedRequest,
  }) => {
    // Raw request - status omitted (a required-field violation) cannot be
    // expressed through the typed service. Proves the aggregator surfaces a
    // blank-title error AND the status two-part error in one response.
    const res = await authedRequest.post(
      `/public/v2/users/${parentUserId}/todos`,
      { data: { title: "" } },
    );
    expect(res.status()).toBe(422);
    const body = await res.json();

    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);

    // SET semantics - sort field names to compare order-independently. Pinning
    // server-side declaration order would couple tests to model internals.
    const errorFields = body.map((e: { field: string }) => e.field).sort();
    expect(errorFields).toEqual(["status", "title"]);

    // Spot-check each message - proves aggregation isn't dropping or mutating
    // individual field errors. toContainEqual is set-membership.
    expect(body).toContainEqual({ field: "title", message: "can't be blank" });
    expect(body).toContainEqual({
      field: "status",
      message: STATUS_BLANK_MESSAGE,
    });
  });
});

test.describe("Todos - validation - verb parity (PATCH/PUT use POST validators)", () => {
  // status is the single representative field for verb-parity (the interesting
  // Todos-specific validator). The property tested is "PATCH and PUT reuse POST
  // validators on sent fields", which is field-agnostic. TC14 additionally
  // pins the state-preservation (atomicity) property: a rejected PATCH must not
  // mutate the existing status.
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

  test("TC14 - PATCH a completed todo with invalid status - 422 AND status stays 'completed' (atomicity)", async ({
    authedRequest,
  }) => {
    // State-transition invalid-event edge: from state `completed`, attempt an
    // event that targets a non-state ('in_progress'). The event is rejected
    // (422) and the machine must remain in `completed`. The GET-by-id check is
    // the real value here over a plain rejection assertion - it guards against
    // a partial-mutation bug where a failed validation still writes state.
    const todos = new TodosService(authedRequest);
    const payload = { title: randomTitle(), status: "completed" };
    const createRes = await todos.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    const patchRes = await todos.patch(createBody.id, {
      status: "in_progress",
    });
    expect(patchRes.status()).toBe(422);
    const patchBody = await patchRes.json();
    expect(patchBody).toContainEqual({
      field: "status",
      message: STATUS_BLANK_MESSAGE,
    });

    // Atomicity: the rejected PATCH left the persisted status untouched.
    const getRes = await todos.getById(createBody.id);
    expect(getRes.status()).toBe(200);
    expect((await getRes.json()).status).toBe(createBody.status);
  });

  test("TC15 - PUT with invalid status (full payload) - 422 (PUT is loose, but sent fields ARE validated)", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const payload = { title: randomTitle(), status: "pending" };
    const createRes = await todos.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);

    const replacement = {
      user_id: parentUserId,
      title: randomTitle(),
      status: "in_progress",
      due_on: null,
    };
    const putRes = await todos.update(createBody.id, replacement);
    expect(putRes.status()).toBe(422);
    const body = await putRes.json();
    expect(body).toContainEqual({
      field: "status",
      message: STATUS_BLANK_MESSAGE,
    });
  });
});

// Parent-existence TCs. The server returns the same [{field, message}] 422
// envelope as field validators, so the structural family is validation. TC16
// uses BOGUS_USER_ID; TC17 creates and deletes an ISOLATED per-test parent so
// the file-scope `parentUserId` stays valid for other describe blocks.

test.describe("Todos - validation - parent existence", () => {
  // createdTodoIds needed by TC18/TC19 which create a real todo and then try to
  // mutate it with a bogus user_id. TC16/TC17 don't create anything (422 before
  // any record persists).
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

  test("TC16 - POST /users/{bogus_user_id}/todos - 422 with [{field:'user',message:'must exist'}]", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const payload = { title: randomTitle(), status: "pending" };
    const res = await todos.create(BOGUS_USER_ID, payload);

    expect(res.status()).toBe(422);
    const body = await res.json();
    // Pin the exact envelope - `field: "user"` (the model relation name), NOT
    // `"user_id"` (the URL param name). Same as Posts; gotcha-pinned.
    expect(body).toEqual([{ field: "user", message: "must exist" }]);
  });

  test("TC17 - POST /users/{deleted_user_id}/todos (state transition) - same 422 as bogus parent", async ({
    authedRequest,
  }) => {
    // State-transition variant of TC16: create a real parent, delete it, then
    // POST to its id. Uses an ISOLATED per-test parent (not the file-scope one)
    // because it deliberately deletes its parent.
    const isolatedParent = await createParentUser(authedRequest);
    await isolatedParent.cleanup();

    const todos = new TodosService(authedRequest);
    const payload = { title: randomTitle(), status: "pending" };
    const res = await todos.create(isolatedParent.id, payload);

    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body).toEqual([{ field: "user", message: "must exist" }]);
  });

  // TC18/TC19 prove the parent-existence validator fires on PATCH and PUT too.
  // Same envelope as TC16/TC17. The validator is verb-agnostic (one rule, three
  // write verbs) - probed 2026-06-05, same as Posts' user_id.

  test("TC18 - PATCH /todos/{id} with bogus user_id - 422 [{field:'user',message:'must exist'}]", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const payload = { title: randomTitle(), status: "pending" };
    const createRes = await todos.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    const patchRes = await todos.patch(createBody.id, {
      user_id: BOGUS_USER_ID,
    });
    expect(patchRes.status()).toBe(422);
    const body = await patchRes.json();
    expect(body).toEqual([{ field: "user", message: "must exist" }]);
  });

  test("TC19 - PUT /todos/{id} with bogus user_id (full payload) - 422 same envelope", async ({
    authedRequest,
  }) => {
    const todos = new TodosService(authedRequest);
    const payload = { title: randomTitle(), status: "pending" };
    const createRes = await todos.create(parentUserId, payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdTodoIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    const replacement = {
      user_id: BOGUS_USER_ID,
      title: randomTitle(),
      status: "completed",
      due_on: null,
    };
    const putRes = await todos.update(createBody.id, replacement);
    expect(putRes.status()).toBe(422);
    const body = await putRes.json();
    expect(body).toEqual([{ field: "user", message: "must exist" }]);
  });
});
