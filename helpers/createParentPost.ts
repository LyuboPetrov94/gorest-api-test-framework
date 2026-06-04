import type { APIRequestContext } from "@playwright/test";
import { PostsService } from "../services/PostsService";
import { createParentUser } from "./createParentUser";
import { randomString } from "./data";

/**
 * Create a throwaway parent post (under a throwaway parent user) for
 * comment tests, and return the post id plus a cleanup closure. Comments are
 * parented by a Post, which is itself parented by a User - so this helper
 * chains `createParentUser` then creates one post.
 *
 * Extracted as a helper for the same reason as `createParentUser` - the
 * user -> post setup ceremony is needed by every comments spec. See
 * tests/api/CLAUDE.md "Nested-resource setup" (it names `createParentPost`
 * as the expected shape when Comments is written).
 *
 * Usage:
 *   const parent = await createParentPost(authedRequest);
 *   // ... use parent.postId ...
 *   await parent.cleanup();   // or push parent.cleanup into an afterAll
 *
 * Cleanup deletes the parent USER, which cascade-deletes the post AND any
 * comments under it (cascade-delete gotcha) - one delete reaps the whole
 * subtree. The closure swallows network/404 errors via `.catch(() => {})`
 * so tests that have already deleted the parent can still call cleanup.
 */
export interface ParentPost {
  postId: number;
  cleanup: () => Promise<void>;
}

export async function createParentPost(
  authedRequest: APIRequestContext,
): Promise<ParentPost> {
  const parentUser = await createParentUser(authedRequest);
  const posts = new PostsService(authedRequest);
  const res = await posts.create(parentUser.id, {
    title: `Parent post ${randomString(8)}`,
    body: `Parent post body ${randomString(16)}.`,
  });
  const body = await res.json();
  // Boundary assertion: a failed post creation here would otherwise surface
  // downstream as a confusing "post must exist" 422 in the comment test that
  // called us, hiding the real cause (rate-limit, parent-user create failed).
  if (res.status() !== 201 || !body?.id) {
    // Reap the user we just created before throwing - don't leak it.
    await parentUser.cleanup();
    throw new Error(
      `createParentPost: expected 201 with body.id, got ${res.status()} ${JSON.stringify(body)}`,
    );
  }
  return {
    postId: body.id,
    // Deleting the user cascade-deletes the post and its comments.
    cleanup: parentUser.cleanup,
  };
}
