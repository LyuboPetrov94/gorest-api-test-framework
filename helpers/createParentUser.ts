import type { APIRequestContext } from "@playwright/test";
import { UsersService } from "../services/UsersService";
import { randomEmail, randomName } from "./data";

/**
 * Create a throwaway parent user for nested-resource tests (posts, todos,
 * comments) and return its id plus a cleanup closure. Extracted as a helper
 * because the same setup ceremony is needed by every nested-resource spec in
 * this project - see tests/api/CLAUDE.md decision #2 (Test user lifecycle).
 *
 * Usage:
 *   const parent = await createParentUser(authedRequest);
 *   // ... use parent.id ...
 *   await parent.cleanup();   // or push parent.cleanup into an afterEach array
 *
 * The cleanup closure swallows network/404 errors via `.catch(() => {})` so
 * tests that have already deleted the parent (e.g. state-transition TCs) can
 * still call cleanup without raising.
 */
export interface ParentUser {
  id: number;
  cleanup: () => Promise<void>;
}

export async function createParentUser(
  authedRequest: APIRequestContext,
): Promise<ParentUser> {
  const users = new UsersService(authedRequest);
  const res = await users.create({
    name: randomName(),
    email: randomEmail(),
    gender: "female",
    status: "active",
  });
  const body = await res.json();
  // Boundary assertion: a failed parent creation here would otherwise surface
  // downstream as a confusing "id undefined" or "422 must exist" error in the
  // test that called us, hiding the real cause (rate-limit, token expired, etc).
  if (res.status() !== 201 || !body?.id) {
    throw new Error(
      `createParentUser: expected 201 with body.id, got ${res.status()} ${JSON.stringify(body)}`,
    );
  }
  return {
    id: body.id,
    cleanup: async () => {
      await users.deleteById(body.id).catch(() => {});
    },
  };
}
