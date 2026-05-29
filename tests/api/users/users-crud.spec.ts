import { test, expect, BASE_URL } from "../../../fixtures";
import { UsersService } from "../../../services/UsersService";
import { request as playwrightRequest } from "@playwright/test";
import { randomEmail, randomName } from "../../../helpers/data";

test.describe("Users - CRUD happy paths", () => {
  let createdIds: number[];

  test.beforeEach(() => {
    createdIds = [];
  });

  test.afterEach(async ({ authedRequest }) => {
    const users = new UsersService(authedRequest);
    for (const id of createdIds) {
      // Best-effort — TC07 already deletes its own resource; second DELETE
      // returns 404, doesn't throw. `.catch(() => {})` only handles network errors.
      await users.deleteById(id).catch(() => {});
    }
  });

  test("TC01 - GET /users (anonymous) - 200, 5-field shape, default page 10", async () => {
    // Anonymous context — no Authorization header. Per the gotcha catalogue,
    // GoRest's GET endpoints are publicly accessible even without a token.
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    try {
      const users = new UsersService(ctx);
      const res = await users.list();

      expect(res.status()).toBe(200);

      // Anonymous = no rate-limit headers (gotcha)
      const headers = res.headers();
      expect(headers["x-ratelimit-limit"]).toBeUndefined();
      expect(headers["x-ratelimit-remaining"]).toBeUndefined();

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(10); // default page size

      // Shape lock: exactly 5 keys, no extras (subset matching would let
      // a server-added field slip through silently)
      const first = body[0];
      expect(Object.keys(first).sort()).toEqual([
        "email",
        "gender",
        "id",
        "name",
        "status",
      ]);

      // Types — id is Number per gotcha (not String, not regex)
      expect(first.id).toEqual(expect.any(Number));
      expect(first.id).toBeGreaterThan(0);
      expect(typeof first.name).toBe("string");
      expect(typeof first.email).toBe("string");
      expect(typeof first.gender).toBe("string");
      expect(typeof first.status).toBe("string");
    } finally {
      await ctx.dispose();
    }
  });

  test("TC02 - GET /users (authed) - same body shape PLUS x-ratelimit-* headers", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const res = await users.list();

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
    // Loose check — at least this request consumed a quota slot. Other parallel
    // tests on the same worker may have consumed more; we don't pin an exact value.
    expect(remaining).toBeLessThan(limit);

    // Body shape parity with TC01
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(Object.keys(body[0]).sort()).toEqual([
      "email",
      "gender",
      "id",
      "name",
      "status",
    ]);
  });

  test("TC03 - POST /users - 201 with server-assigned id, body echoes payload", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const payload = {
      name: randomName(),
      email: randomEmail(),
      gender: "female",
      status: "active",
    };

    const res = await users.create(payload);
    const body = await res.json();

    // Push for cleanup BEFORE assertions — a failing assertion below should
    // still leave a deleteable id behind. Same pattern as prior project notes-crud.
    if (body?.id) createdIds.push(body.id);

    expect(res.status()).toBe(201);
    expect(res.headers()["content-type"]).toContain("application/json");

    expect(body.id).toEqual(expect.any(Number));
    expect(body.id).toBeGreaterThan(0);
    expect(body.name).toBe(payload.name);
    expect(body.email).toBe(payload.email);
    expect(body.gender).toBe(payload.gender);
    expect(body.status).toBe(payload.status);
  });

  test("TC04 - GET /users/{id} - round-trip identity (create then fetch returns equal body)", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const payload = {
      name: randomName(),
      email: randomEmail(),
      gender: "male",
      status: "active",
    };

    const createRes = await users.create(payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    const getRes = await users.getById(createBody.id);
    expect(getRes.status()).toBe(200);
    const getBody = await getRes.json();

    // Deep equality — GoRest returns the same shape from GET as from POST
    expect(getBody).toEqual(createBody);
  });

  // TC05 + TC06 note: GoRest's PUT is loose (behaves like PATCH — accepts
  // partials, preserves unsent fields). Per the gotcha catalogue. Both TCs
  // exist for verb-coverage; they don't prove distinct semantics on this API.

  test("TC05 - PUT /users/{id} - full replace: all 4 fields change", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const original = {
      name: randomName(),
      email: randomEmail(),
      gender: "female",
      status: "active",
    };
    const createRes = await users.create(original);
    const createBody = await createRes.json();
    if (createBody?.id) createdIds.push(createBody.id);

    const replacement = {
      name: randomName(),
      email: randomEmail(),
      gender: "male",
      status: "inactive",
    };
    const putRes = await users.update(createBody.id, replacement);
    expect(putRes.status()).toBe(200);

    const putBody = await putRes.json();
    expect(putBody.id).toBe(createBody.id); // id preserved across replace
    expect(putBody.name).toBe(replacement.name);
    expect(putBody.email).toBe(replacement.email);
    expect(putBody.gender).toBe(replacement.gender);
    expect(putBody.status).toBe(replacement.status);
  });

  test("TC06 - PATCH /users/{id} - partial update: name changes, others unchanged", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const original = {
      name: randomName(),
      email: randomEmail(),
      gender: "female",
      status: "active",
    };
    const createRes = await users.create(original);
    const createBody = await createRes.json();
    if (createBody?.id) createdIds.push(createBody.id);

    const newName = randomName();
    const patchRes = await users.patch(createBody.id, { name: newName });
    expect(patchRes.status()).toBe(200);

    const patchBody = await patchRes.json();
    expect(patchBody.id).toBe(createBody.id);
    expect(patchBody.name).toBe(newName); // changed
    // The partial-update property: unsent fields preserve original values
    expect(patchBody.email).toBe(original.email);
    expect(patchBody.gender).toBe(original.gender);
    expect(patchBody.status).toBe(original.status);
  });

  test("TC07 - DELETE /users/{id} state transition: 204 then 404 on follow-up GET", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const payload = {
      name: randomName(),
      email: randomEmail(),
      gender: "female",
      status: "active",
    };
    const createRes = await users.create(payload);
    const createBody = await createRes.json();
    if (createBody?.id) createdIds.push(createBody.id);

    const delRes = await users.deleteById(createBody.id);
    expect(delRes.status()).toBe(204);
    // 204 = No Content; assert the body is genuinely empty (not just JSON-empty)
    const delText = await delRes.text();
    expect(delText).toBe("");

    // State transition verification: GET should now 404 with JSON envelope
    const getRes = await users.getById(createBody.id);
    expect(getRes.status()).toBe(404);
    const getBody = await getRes.json();
    expect(getBody).toEqual({ message: "Resource not found" });
  });

  test("TC08 - GET /users pagination headers contract", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const res = await users.list();
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
    // and "pages reports stale total" regressions.
    expect(pages).toBe(Math.ceil(total / limit));

    // Link headers — `x-links-previous` is empty string on page 1, don't assert it
    expect(headers["x-links-current"]).toMatch(/[?&]page=1\b/);
    expect(headers["x-links-next"]).toBeTruthy();
  });
});
