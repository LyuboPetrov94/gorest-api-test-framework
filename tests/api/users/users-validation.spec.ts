import { test, expect } from "../../../fixtures";
import { UsersService } from "../../../services/UsersService";
import { randomEmail, randomName, randomString } from "../../../helpers/data";

// All assertions on the 422 error array use `expect(body).toContainEqual(...)`
// - set semantics, no order coupling. See "GoRest aggregates ALL validation
// errors" gotcha in tests/api/CLAUDE.md.

test.describe("Users - validation - email format", () => {
  // No cleanup needed in this block - all TCs expect 422 (no resource created).

  test("TC01 - POST malformed email 'not-an-email' - 422", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const res = await users.create({
      name: randomName(),
      email: "not-an-email",
      gender: "female",
      status: "active",
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body).toContainEqual({ field: "email", message: "is invalid" });
  });

  test("TC02 - POST with missing email field - 422", async ({
    authedRequest,
  }) => {
    // Raw request bypasses UsersService.create (which requires email per type)
    // - same pattern as prior project's `"" as unknown as boolean` for negative
    // tests. The cast keeps the service signature strict for happy-path callers.
    const res = await authedRequest.post("/public/v2/users", {
      data: { name: randomName(), gender: "female", status: "active" },
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body).toContainEqual({
      field: "email",
      message: "can't be blank",
    });
  });

  test("TC03 - POST with empty email '' - 422 (same response as missing, distinct EP class)", async ({
    authedRequest,
  }) => {
    // Same response as TC02 - kept to document the distinct EP class. Mirrors
    // the prior project's pattern of keeping wrong-password and non-existent-email
    // as separate TCs even though both return identical 401s.
    const users = new UsersService(authedRequest);
    const res = await users.create({
      name: randomName(),
      email: "",
      gender: "female",
      status: "active",
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body).toContainEqual({
      field: "email",
      message: "can't be blank",
    });
  });
});

test.describe("Users - validation - gender enum", () => {
  let createdIds: number[];

  test.beforeEach(() => {
    createdIds = [];
  });

  test.afterEach(async ({ authedRequest }) => {
    const users = new UsersService(authedRequest);
    for (const id of createdIds) {
      await users.deleteById(id).catch(() => {});
    }
  });

  test("TC04 - POST invalid gender 'banana' - 422 (pins server typo 'male of female')", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const res = await users.create({
      name: randomName(),
      email: randomEmail(),
      gender: "banana",
      status: "active",
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    // Server-side typo: "of" instead of "or". Pin exactly - see gotcha.
    expect(body).toContainEqual({
      field: "gender",
      message: "can't be blank, can be male of female",
    });
  });

  test("TC05 - POST gender 'Female' (case-insensitivity) - 201 + response normalized to 'female'", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const res = await users.create({
      name: randomName(),
      email: randomEmail(),
      gender: "Female",
      status: "active",
    });
    const body = await res.json();
    if (body?.id) createdIds.push(body.id);

    expect(res.status()).toBe(201);
    expect(body.gender).toBe("female"); // case normalized server-side
  });
});

test.describe("Users - validation - status enum", () => {
  let createdIds: number[];

  test.beforeEach(() => {
    createdIds = [];
  });

  test.afterEach(async ({ authedRequest }) => {
    const users = new UsersService(authedRequest);
    for (const id of createdIds) {
      await users.deleteById(id).catch(() => {});
    }
  });

  test("TC06 - POST invalid status 'banana' - 422 (terse message, no enum list)", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const res = await users.create({
      name: randomName(),
      email: randomEmail(),
      gender: "female",
      status: "banana",
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    // Terser than gender's message - does NOT enumerate options. Pin exactly.
    expect(body).toContainEqual({
      field: "status",
      message: "can't be blank",
    });
  });

  test("TC07 - POST status 'Active' (case-insensitivity) - 201 + response normalized to 'active'", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const res = await users.create({
      name: randomName(),
      email: randomEmail(),
      gender: "female",
      status: "Active",
    });
    const body = await res.json();
    if (body?.id) createdIds.push(body.id);

    expect(res.status()).toBe(201);
    expect(body.status).toBe("active");
  });
});

test.describe("Users - validation - name length BVA (1-200)", () => {
  let createdIds: number[];

  test.beforeEach(() => {
    createdIds = [];
  });

  test.afterEach(async ({ authedRequest }) => {
    const users = new UsersService(authedRequest);
    for (const id of createdIds) {
      await users.deleteById(id).catch(() => {});
    }
  });

  // 3-point BVA at both bounds. Keep all six points per CLAUDE.md rule:
  // "The points document the boundary's shape, not only outcome diversity."
  const nameBVA = [
    {
      tc: "TC08",
      length: 0,
      status: 422,
      errorMessage: "can't be blank",
    },
    { tc: "TC09", length: 1, status: 201, errorMessage: null },
    { tc: "TC10", length: 2, status: 201, errorMessage: null },
    { tc: "TC11", length: 199, status: 201, errorMessage: null },
    { tc: "TC12", length: 200, status: 201, errorMessage: null },
    {
      tc: "TC13",
      length: 201,
      status: 422,
      errorMessage: "is too long (maximum is 200 characters)",
    },
  ];

  for (const { tc, length, status, errorMessage } of nameBVA) {
    test(`${tc} - POST name length ${length}`, async ({ authedRequest }) => {
      const users = new UsersService(authedRequest);
      const res = await users.create({
        name: randomString(length),
        email: randomEmail(),
        gender: "female",
        status: "active",
      });
      const body = await res.json();
      if (status === 201 && body?.id) createdIds.push(body.id);

      expect(res.status()).toBe(status);
      if (errorMessage !== null) {
        // eslint-disable-next-line playwright/no-conditional-expect -- status asserted unconditionally above; only the failure-row message is guarded
        expect(body).toContainEqual({ field: "name", message: errorMessage });
      }
    });
  }
});

test.describe("Users - validation - error aggregation", () => {
  test("TC14 - POST all 4 fields invalid - 422 with all 4 errors aggregated (set semantics, not order)", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const res = await users.create({
      name: "",
      email: "bad",
      gender: "banana",
      status: "banana",
    });
    expect(res.status()).toBe(422);
    const body = await res.json();

    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(4);

    // SET semantics - sort field names to compare order-independently. Pinning
    // server-side declaration order would couple tests to model internals.
    const errorFields = body.map((e: { field: string }) => e.field).sort();
    expect(errorFields).toEqual(["email", "gender", "name", "status"]);

    // Spot-check each error message - proves the aggregation isn't dropping or
    // mutating individual field errors. toContainEqual is set-membership.
    expect(body).toContainEqual({ field: "name", message: "can't be blank" });
    expect(body).toContainEqual({
      field: "gender",
      message: "can't be blank, can be male of female",
    });
    expect(body).toContainEqual({
      field: "status",
      message: "can't be blank",
    });
    expect(body).toContainEqual({ field: "email", message: "is invalid" });
  });
});

test.describe("Users - validation - verb parity (PATCH/PUT use POST validators)", () => {
  let createdIds: number[];

  test.beforeEach(() => {
    createdIds = [];
  });

  test.afterEach(async ({ authedRequest }) => {
    const users = new UsersService(authedRequest);
    for (const id of createdIds) {
      await users.deleteById(id).catch(() => {});
    }
  });

  test("TC15 - PATCH with invalid gender - 422 (PATCH reuses POST validators)", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const createRes = await users.create({
      name: randomName(),
      email: randomEmail(),
      gender: "female",
      status: "active",
    });
    const createBody = await createRes.json();
    if (createBody?.id) createdIds.push(createBody.id);

    const patchRes = await users.patch(createBody.id, { gender: "banana" });
    expect(patchRes.status()).toBe(422);
    const body = await patchRes.json();
    expect(body).toContainEqual({
      field: "gender",
      message: "can't be blank, can be male of female",
    });
  });

  test("TC16 - PUT with invalid gender - 422 (PUT is loose, but sent fields ARE validated)", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const createRes = await users.create({
      name: randomName(),
      email: randomEmail(),
      gender: "female",
      status: "active",
    });
    const createBody = await createRes.json();
    if (createBody?.id) createdIds.push(createBody.id);

    // Raw PUT with only gender to test sent-field validation. UsersService.update
    // requires UpdateUserPayload (all 4 fields per defensive TS convention);
    // bypassing for the negative test, same pattern as TC02.
    const putRes = await authedRequest.put(
      `/public/v2/users/${createBody.id}`,
      { data: { gender: "banana" } },
    );
    expect(putRes.status()).toBe(422);
    const body = await putRes.json();
    expect(body).toContainEqual({
      field: "gender",
      message: "can't be blank, can be male of female",
    });
  });
});
