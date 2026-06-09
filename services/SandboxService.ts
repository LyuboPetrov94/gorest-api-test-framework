import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { CreateUserPayload } from "./UsersService";

/**
 * Wraps GoRest's sandbox query-param features (?force_status, ?delay) and the
 * rate-limit behavior - capabilities the prior Notes API did not offer. These
 * are cross-cutting MIDDLEWARE knobs, not a real resource: they are honored on
 * any endpoint and any verb identically (route- and verb-agnostic, see
 * tests/api/CLAUDE.md "force_status" gotcha). We target /public/v2/users as a
 * neutral CARRIER endpoint - testing the feature once on a representative route
 * is full coverage (one equivalence class across all endpoints/verbs), since
 * the middleware runs before routing and does not vary per resource.
 *
 * The rate-limit helpers are added when that spec lands (same incremental
 * "service first, then spec" rhythm as the resource services).
 */
export class SandboxService {
  // Full path includes `/public/v2/` prefix - `baseURL` is origin only.
  // See tests/api/CLAUDE.md "Known Gotchas" -> URL resolution.
  private readonly endpoint = "/public/v2/users";

  constructor(private readonly request: APIRequestContext) {}

  // GET the carrier endpoint with ?force_status=<code>. GoRest honors real HTTP
  // error codes (4xx/5xx) -> simulated-error envelope; out-of-allowlist values
  // are ignored and the request proceeds normally. `code` is `number | string`
  // so negative tests can feed non-numeric / out-of-range values.
  async forceStatus(code: number | string): Promise<APIResponse> {
    return this.request.get(this.endpoint, {
      params: { force_status: code },
    });
  }

  // POST the carrier endpoint with ?force_status=<code>. Used to prove the
  // simulation short-circuits BEFORE persistence: a forced error on POST
  // returns the simulated envelope and creates NO resource (no id echoed).
  // Verb-agnostic - one non-GET representative is enough (EP: force_status is
  // route- and verb-independent).
  async forceStatusOnCreate(
    code: number | string,
    payload: CreateUserPayload,
  ): Promise<APIResponse> {
    return this.request.post(this.endpoint, {
      params: { force_status: code },
      data: payload,
    });
  }

  // GET the carrier endpoint with ?delay=<ms>. GoRest holds the response for
  // <ms> milliseconds, capped server-side at 5000ms; non-numeric values are
  // ignored. Latency only - the body is the normal response. `ms` is
  // `number | string` so negative tests can feed non-numeric values.
  async withDelay(ms: number | string): Promise<APIResponse> {
    return this.request.get(this.endpoint, {
      params: { delay: ms },
    });
  }

  // GET the carrier endpoint with BOTH ?delay and ?force_status set. Pins the
  // middleware ordering: force_status short-circuits ahead of the delay, so the
  // forced status is returned fast (the delay is NOT applied).
  async delayWithForcedStatus(
    ms: number | string,
    code: number | string,
  ): Promise<APIResponse> {
    return this.request.get(this.endpoint, {
      params: { delay: ms, force_status: code },
    });
  }

  // Plain GET of the carrier endpoint with no sandbox params. Used by the
  // rate-limit spec for the header-contract checks and the concurrent burst.
  async list(): Promise<APIResponse> {
    return this.request.get(this.endpoint);
  }
}
