import { test, expect } from "../../../fixtures";
import { UsersService } from "../../../services/UsersService";
import { TodosService } from "../../../services/TodosService";
import { randomEmail, randomName } from "../../../helpers/data";

/**
 * Cross-account data isolation (Users carrier).
 *
 * GoRest isolates data per ACCOUNT, not per token: a token sees and can mutate
 * only records owned by its own account. This spec exercises the one partition
 * the single-token security specs cannot reach - a VALID token acting on a
 * resource owned by a DIFFERENT account:
 *
 *   - MAIN (authedRequest)    = the suite's primary account token.
 *   - SUB  (authedRequestSub) = a token from a SEPARATE GoRest account
 *                               (GOREST_TOKEN_SUB - see fixtures/index.ts).
 *
 * Probed 2026-06-18 with two genuinely separate accounts; the expected status
 * codes are observed, not assumed. Isolation has two signatures:
 *   - by-id       (/users/{id})        -> 404 "Resource not found"
 *   - nested-list (/users/{id}/todos)  -> 200 [] (owner's children filtered out)
 *
 * Positive controls (SUB acting on its OWN records -> 200) prove the 404s are
 * isolation, not a dead/expired SUB token. Each write-isolation TC also has
 * MAIN re-read its record to prove SUB's rejected write was a true no-op.
 *
 * One carrier (Users) is full coverage: isolation is a platform-wide property
 * (token scoping), not per-resource logic - same rationale as the sandbox
 * middleware specs. Direction is one-way (SUB on MAIN's resource); the reverse
 * is the same code path, so per EP it is not duplicated.
 *
 * Tagged @isolation and EXCLUDED from the default run (`npm test` / `npm run
 * test:api` use `--grep-invert "@ratelimit|@isolation"`). Runs in its own CI
 * job via `npm run test:isolation`, so a lapse of the second-account token
 * reddens only that job, not the main suite.
 */

test.describe(
  "Cross-account data isolation (Users carrier)",
  { tag: "@isolation" },
  () => {
    let usersMain: UsersService;
    let usersSub: UsersService;
    let todosMain: TodosService;
    let todosSub: TodosService;

    // MAIN's user, captured at creation - the integrity baseline for the
    // write-isolation TCs (SUB must leave it byte-identical).
    let uMain: {
      id: number;
      name: string;
      email: string;
      gender: string;
      status: string;
    };
    let uSubId: number; // SUB's own user - target of the positive controls
    let todoId: number; // a todo MAIN owns under uMain - the child SUB must not see

    test.beforeAll(async ({ authedRequest, authedRequestSub }) => {
      usersMain = new UsersService(authedRequest);
      usersSub = new UsersService(authedRequestSub);
      todosMain = new TodosService(authedRequest);
      todosSub = new TodosService(authedRequestSub);

      // Inline payloads - content is irrelevant to the isolation assertions,
      // matching the security-spec convention.
      const createMain = await usersMain.create({
        name: randomName(),
        email: randomEmail(),
        gender: "male",
        status: "active",
      });
      expect(createMain.status()).toBe(201);
      uMain = await createMain.json();

      const createSub = await usersSub.create({
        name: randomName(),
        email: randomEmail(),
        gender: "female",
        status: "active",
      });
      expect(createSub.status()).toBe(201);
      uSubId = (await createSub.json()).id;

      // MAIN creates a todo under its user - the child SUB must NOT see in TC07.
      const createTodo = await todosMain.create(uMain.id, {
        title: randomName(),
        status: "pending",
      });
      expect(createTodo.status()).toBe(201);
      todoId = (await createTodo.json()).id;
    });

    test.afterAll(async () => {
      // Each token deletes only its OWN records. SUB never touched MAIN's data,
      // so MAIN cleans up uMain + its todo; SUB cleans up uSub.
      if (todoId !== undefined) await todosMain.deleteById(todoId);
      if (uMain !== undefined) await usersMain.deleteById(uMain.id);
      if (uSubId !== undefined) await usersSub.deleteById(uSubId);
    });

    test.describe("Read isolation", () => {
      test("TC01 - SUB cannot read MAIN's user (404)", async () => {
        const res = await usersSub.getById(uMain.id);
        expect(res.status()).toBe(404);
        expect(await res.json()).toEqual({ message: "Resource not found" });
      });

      test("TC02 - SUB can read its own user (positive control)", async () => {
        const res = await usersSub.getById(uSubId);
        expect(res.status()).toBe(200);
        expect((await res.json()).id).toBe(uSubId);
      });
    });

    test.describe("Write isolation", () => {
      // PUT / PATCH / DELETE by SUB on MAIN's user. Each is rejected 404 (SUB
      // can't even see the resource), then MAIN re-reads to prove no silent
      // mutation or deletion. Inline write payloads - content is irrelevant, the
      // request never crosses the isolation boundary to reach validation.
      const writeAttempts = [
        {
          tc: "TC03",
          verb: "PUT",
          act: () =>
            usersSub.update(uMain.id, {
              name: "HIJACKED",
              email: randomEmail(),
              gender: "male",
              status: "inactive",
            }),
        },
        {
          tc: "TC04",
          verb: "PATCH",
          act: () => usersSub.patch(uMain.id, { name: "HIJACKED-PATCH" }),
        },
        {
          tc: "TC05",
          verb: "DELETE",
          act: () => usersSub.deleteById(uMain.id),
        },
      ];

      for (const { tc, verb, act } of writeAttempts) {
        test(`${tc} - SUB ${verb} on MAIN's user is rejected (404), record untouched`, async () => {
          const res = await act();
          expect(res.status()).toBe(404);
          expect(await res.json()).toEqual({ message: "Resource not found" });

          // Integrity: MAIN re-reads uMain - still present and byte-identical to
          // what it created. Proves SUB's rejected write had zero side effect.
          const reread = await usersMain.getById(uMain.id);
          expect(reread.status()).toBe(200);
          expect(await reread.json()).toEqual(uMain);
        });
      }

      test("TC06 - SUB can modify its own user (positive control)", async () => {
        const res = await usersSub.patch(uSubId, { name: "SUB-renamed-own" });
        expect(res.status()).toBe(200);
        expect((await res.json()).name).toBe("SUB-renamed-own");
      });
    });

    test.describe("Nested-list isolation", () => {
      test("TC07 - SUB cannot see MAIN's todos via the nested list (200 [])", async () => {
        // Owner baseline: MAIN sees its todo under uMain - proves the todo
        // exists, so SUB's empty result is isolation, not an empty user.
        const ownerView = await todosMain.listByUser(uMain.id);
        expect(ownerView.status()).toBe(200);
        expect(await ownerView.json()).toContainEqual(
          expect.objectContaining({ id: todoId }),
        );

        // Cross-account: SUB lists the SAME path -> 200 with an EMPTY array (not
        // 404, and crucially not MAIN's todo). Mirrors the anonymous nested-list
        // shape documented in tests/api/CLAUDE.md.
        const crossView = await todosSub.listByUser(uMain.id);
        expect(crossView.status()).toBe(200);
        expect(await crossView.json()).toEqual([]);
      });
    });
  },
);
