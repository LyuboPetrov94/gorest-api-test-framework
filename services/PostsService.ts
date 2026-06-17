import type { APIRequestContext, APIResponse } from "@playwright/test";

export interface CreatePostPayload {
  // Deliberately no `user_id` field: the URL path is the source of truth for
  // parentage. The body's `user_id` is silently dropped if sent alongside a
  // path id - see tests/api/CLAUDE.md "user_id in a POST body is silently
  // ignored" gotcha. Encoding the contract in the type prevents callers from
  // accidentally trying to set parentage through the payload.
  title: string;
  body: string;
}

// All fields required as a defensive TS convention - encodes standard REST PUT
// semantics (full replacement). GoRest's actual PUT is loose like Users (see
// "PUT /users/{id} is loose" gotcha) - it accepts partials and preserves unsent
// fields, equivalent to PATCH. For partial updates, use `PatchPostPayload` via
// `.patch()`.
export interface UpdatePostPayload {
  user_id: number;
  title: string;
  body: string;
}

export interface PatchPostPayload {
  user_id?: number;
  title?: string;
  body?: string;
}

export class PostsService {
  // Full path includes `/public/v2/` prefix - `baseURL` is origin only.
  // See tests/api/CLAUDE.md "Known Gotchas" → URL resolution.
  private readonly postsEndpoint = "/public/v2/posts";
  private readonly usersEndpoint = "/public/v2/users";

  constructor(private readonly request: APIRequestContext) {}

  async listAll(): Promise<APIResponse> {
    return this.request.get(this.postsEndpoint);
  }

  async listByUser(userId: number): Promise<APIResponse> {
    return this.request.get(`${this.usersEndpoint}/${userId}/posts`);
  }

  async create(
    userId: number,
    payload: CreatePostPayload,
  ): Promise<APIResponse> {
    return this.request.post(`${this.usersEndpoint}/${userId}/posts`, {
      data: payload,
    });
  }

  async getById(postId: number): Promise<APIResponse> {
    return this.request.get(`${this.postsEndpoint}/${postId}`);
  }

  async update(
    postId: number,
    payload: UpdatePostPayload,
  ): Promise<APIResponse> {
    return this.request.put(`${this.postsEndpoint}/${postId}`, {
      data: payload,
    });
  }

  async patch(postId: number, partial: PatchPostPayload): Promise<APIResponse> {
    return this.request.patch(`${this.postsEndpoint}/${postId}`, {
      data: partial,
    });
  }

  async deleteById(postId: number): Promise<APIResponse> {
    return this.request.delete(`${this.postsEndpoint}/${postId}`);
  }
}
