import type { APIRequestContext, APIResponse } from "@playwright/test";

export interface CreateUserPayload {
  name: string;
  email: string;
  gender: string; // kept as string (not a union) so validation negatives can pass invalid values
  status: string; // same reasoning — "active" / "inactive" in happy paths
}

// All fields required as a defensive TS convention — forces callers to think
// about full state at the call site, encoding standard REST PUT semantics.
// GoRest's actual PUT is loose (accepts partials, preserves unsent fields —
// equivalent to PATCH). See tests/api/CLAUDE.md "PUT /users/{id} is loose"
// gotcha. For partial updates, use `PatchUserPayload` via `.patch()`.
export interface UpdateUserPayload {
  name: string;
  email: string;
  gender: string;
  status: string;
}

export interface PatchUserPayload {
  name?: string;
  email?: string;
  gender?: string;
  status?: string;
}

export class UsersService {
  // Full path includes `/public/v2/` prefix — `baseURL` is origin only.
  // See tests/api/CLAUDE.md "Known Gotchas" → URL resolution.
  private readonly endpoint = "/public/v2/users";

  constructor(private readonly request: APIRequestContext) {}

  async list(): Promise<APIResponse> {
    return this.request.get(this.endpoint);
  }

  async getById(id: number): Promise<APIResponse> {
    return this.request.get(`${this.endpoint}/${id}`);
  }

  async create(payload: CreateUserPayload): Promise<APIResponse> {
    return this.request.post(this.endpoint, { data: payload });
  }

  async update(id: number, payload: UpdateUserPayload): Promise<APIResponse> {
    return this.request.put(`${this.endpoint}/${id}`, { data: payload });
  }

  async patch(id: number, partial: PatchUserPayload): Promise<APIResponse> {
    return this.request.patch(`${this.endpoint}/${id}`, { data: partial });
  }

  async deleteById(id: number): Promise<APIResponse> {
    return this.request.delete(`${this.endpoint}/${id}`);
  }
}
