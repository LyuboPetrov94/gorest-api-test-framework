import { test, expect } from "../../../fixtures";
import { UsersService } from "../../../services/UsersService";
import { UserSchema, UserListSchema } from "../../../schemas/UserSchemas";
import { randomEmail, randomName } from "../../../helpers/data";
import type { ZodSafeParseResult } from "zod";

// Inline failure formatter - turns Playwright's default `expected false to be
// true` into a readable `<path>: <message>` per zod issue. Passed as the
// second arg to `expect().toBe(true)`. Zod v4 type is ZodSafeParseResult<T>
// (single param, output type); issue.path is PropertyKey[] so `.map(String)`
// is required before `.join(".")` to satisfy TS.
function formatZodError<T>(result: ZodSafeParseResult<T>): string {
  return result.success
    ? ""
    : result.error.issues
        .map((i) => `${i.path.map(String).join(".")}: ${i.message}`)
        .join("\n");
}

test.describe("Users - schema validation", () => {
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

  test("TC01 - POST /users response validates against UserSchema (strict)", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const res = await users.create({
      name: randomName(),
      email: randomEmail(),
      gender: "female",
      status: "active",
    });
    const body = await res.json();
    // Push for cleanup BEFORE assertions - failing assertion still leaves a
    // deleteable id behind.
    if (body?.id) createdIds.push(body.id);

    expect(res.status()).toBe(201);

    // The whole shape locked in one call. .strict() means any extra field
    // server-side fails the schema - the regression net we don't get from
    // toMatchObject.
    const result = UserSchema.safeParse(body);
    expect(result.success, formatZodError(result)).toBe(true);
  });

  test("TC02 - GET /users/{id} response validates against UserSchema (demonstrates schema reuse across endpoints)", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);

    // Setup: create a user so there's something to GET
    const createRes = await users.create({
      name: randomName(),
      email: randomEmail(),
      gender: "male",
      status: "active",
    });
    const createBody = await createRes.json();
    if (createBody?.id) createdIds.push(createBody.id);
    expect(createRes.status()).toBe(201);

    // Act: GET the user, validate against the SAME UserSchema used for POST.
    // Single source of truth for the User resource shape across both endpoints.
    const getRes = await users.getById(createBody.id);
    expect(getRes.status()).toBe(200);
    const body = await getRes.json();

    const result = UserSchema.safeParse(body);
    expect(result.success, formatZodError(result)).toBe(true);
  });

  test("TC03 - UserSchema rejects a hand-crafted payload missing id (unit-test-of-the-schema)", async () => {
    // No API call here. Pure unit test against the schema itself - proves the
    // schema is meaningful rather than accidentally permissive. Without this
    // TC, a too-loose schema (e.g. z.object({}).passthrough()) would silently
    // green-pass every happy-path TC above.
    const malformed = {
      // id deliberately missing
      name: "Test User",
      email: "test@example.com",
      gender: "female",
      status: "active",
    };

    const result = UserSchema.safeParse(malformed);
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasIdError = result.error.issues.some(
        (i) => i.path.map(String).join(".") === "id",
      );
      expect(hasIdError).toBe(true);
    }
  });

  test("TC04 - GET /users (list) response validates against UserListSchema (schema composition over arrays)", async ({
    authedRequest,
  }) => {
    const users = new UsersService(authedRequest);
    const res = await users.list();
    expect(res.status()).toBe(200);
    const body = await res.json();

    // UserListSchema = z.array(UserSchema). Every item including the shared
    // seed data must pass strict UserSchema - a server-added field on ANY
    // list item fails. Wider regression net than the per-user TCs above.
    const result = UserListSchema.safeParse(body);
    expect(result.success, formatZodError(result)).toBe(true);
  });
});
