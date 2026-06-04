import type { APIRequestContext, APIResponse } from "@playwright/test";

export interface CreateCommentPayload {
  // Deliberately no `post_id` field: the URL path is the source of truth for
  // parentage, exactly as `CreatePostPayload` omits `user_id`. The body's
  // `post_id` would be silently dropped if sent alongside a path id (same
  // path-wins contract as Posts). Encoding it in the type stops callers from
  // trying to set parentage through the payload.
  name: string;
  email: string;
  body: string;
}

// All fields required as a defensive TS convention - encodes standard REST PUT
// semantics (full replacement). GoRest's actual PUT is loose (see "PUT is
// loose" gotcha) - it accepts partials and preserves unsent fields, equivalent
// to PATCH. For partial updates, use `PatchCommentPayload` via `.patch()`.
export interface UpdateCommentPayload {
  post_id: number;
  name: string;
  email: string;
  body: string;
}

export interface PatchCommentPayload {
  post_id?: number;
  name?: string;
  email?: string;
  body?: string;
}

export class CommentsService {
  // Full path includes `/public/v2/` prefix - `baseURL` is origin only.
  // See tests/api/CLAUDE.md "Known Gotchas" -> URL resolution.
  private readonly commentsEndpoint = "/public/v2/comments";
  private readonly postsEndpoint = "/public/v2/posts";

  constructor(private readonly request: APIRequestContext) {}

  async listAll(): Promise<APIResponse> {
    return this.request.get(this.commentsEndpoint);
  }

  async listByPost(postId: number): Promise<APIResponse> {
    return this.request.get(`${this.postsEndpoint}/${postId}/comments`);
  }

  async create(
    postId: number,
    payload: CreateCommentPayload,
  ): Promise<APIResponse> {
    return this.request.post(`${this.postsEndpoint}/${postId}/comments`, {
      data: payload,
    });
  }

  async getById(commentId: number): Promise<APIResponse> {
    return this.request.get(`${this.commentsEndpoint}/${commentId}`);
  }

  async update(
    commentId: number,
    payload: UpdateCommentPayload,
  ): Promise<APIResponse> {
    return this.request.put(`${this.commentsEndpoint}/${commentId}`, {
      data: payload,
    });
  }

  async patch(
    commentId: number,
    partial: PatchCommentPayload,
  ): Promise<APIResponse> {
    return this.request.patch(`${this.commentsEndpoint}/${commentId}`, {
      data: partial,
    });
  }

  async deleteById(commentId: number): Promise<APIResponse> {
    return this.request.delete(`${this.commentsEndpoint}/${commentId}`);
  }
}
