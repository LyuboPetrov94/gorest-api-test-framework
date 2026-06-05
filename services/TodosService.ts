import type { APIRequestContext, APIResponse } from "@playwright/test";

// `status` is a required enum on POST (pending/completed, case-insensitive -
// server normalizes "Pending" -> "pending"). See tests/api/CLAUDE.md
// "status is a required enum on POST" gotcha. `due_on` is optional and has NO
// format validation - invalid input is silently coerced to null (gotcha).

export interface CreateTodoPayload {
  // Deliberately no `user_id` field: the URL path is the source of truth for
  // parentage, exactly as `CreatePostPayload`/`CreateCommentPayload` omit it.
  // The body's `user_id` would be silently dropped if sent alongside a path id
  // (path-wins contract). Encoding it in the type stops callers from trying to
  // set parentage through the payload.
  title: string;
  status: string; // kept as string (not a union) so validation negatives can pass invalid values - matches UsersService gender/status
  // Optional: omitting `due_on` stores null (201). When sent, a plain date
  // ("2026-07-01") is accepted and normalized to IST midnight on read.
  due_on?: string;
}

// All fields required as a defensive TS convention - encodes standard REST PUT
// semantics (full replacement). GoRest's actual PUT is loose (see "PUT is
// loose" gotcha) - it accepts partials and preserves unsent fields, equivalent
// to PATCH. `due_on` is `string | null` (required key, nullable value) so a
// full replace must state the due date explicitly or null it. For partial
// updates, use `PatchTodoPayload` via `.patch()`.
export interface UpdateTodoPayload {
  user_id: number;
  title: string;
  status: string;
  due_on: string | null;
}

export interface PatchTodoPayload {
  user_id?: number;
  title?: string;
  status?: string;
  due_on?: string | null;
}

export class TodosService {
  // Full path includes `/public/v2/` prefix - `baseURL` is origin only.
  // See tests/api/CLAUDE.md "Known Gotchas" -> URL resolution.
  private readonly todosEndpoint = "/public/v2/todos";
  private readonly usersEndpoint = "/public/v2/users";

  constructor(private readonly request: APIRequestContext) {}

  async listAll(): Promise<APIResponse> {
    return this.request.get(this.todosEndpoint);
  }

  async listByUser(userId: number): Promise<APIResponse> {
    return this.request.get(`${this.usersEndpoint}/${userId}/todos`);
  }

  async create(
    userId: number,
    payload: CreateTodoPayload,
  ): Promise<APIResponse> {
    return this.request.post(`${this.usersEndpoint}/${userId}/todos`, {
      data: payload,
    });
  }

  async getById(todoId: number): Promise<APIResponse> {
    return this.request.get(`${this.todosEndpoint}/${todoId}`);
  }

  async update(
    todoId: number,
    payload: UpdateTodoPayload,
  ): Promise<APIResponse> {
    return this.request.put(`${this.todosEndpoint}/${todoId}`, {
      data: payload,
    });
  }

  async patch(
    todoId: number,
    partial: PatchTodoPayload,
  ): Promise<APIResponse> {
    return this.request.patch(`${this.todosEndpoint}/${todoId}`, {
      data: partial,
    });
  }

  async deleteById(todoId: number): Promise<APIResponse> {
    return this.request.delete(`${this.todosEndpoint}/${todoId}`);
  }
}
