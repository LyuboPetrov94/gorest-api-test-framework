# Test Plan

Coverage status across the GoRest API surface. Updated as specs land. For per-TC detail, read the spec files directly.

## Resource coverage

| Resource | CRUD | Validation | Security | Schema | Total |
|---|---|---|---|---|---|
| Users | ✅ 8 | ✅ 16 | ✅ 11 | ✅ 4 | 39 |
| Posts | ✅ 11 | ✅ 19 | ✅ 13 | - | 43 |
| Comments | ✅ 11 | ✅ 23 | ✅ 13 | - | 47 |
| Todos | 🔲 0 | 🔲 0 | - | - | 0 |
| **Total** | **30** | **58** | **37** | **4** | **129** |

## Bonus specs (sandbox features unique to GoRest)

These exercise GoRest-specific capabilities that don't fit the standard CRUD/validation/security/schema lens.

| Spec | Coverage | TCs |
|---|---|---|
| Rate-limit headers + 429 behavior | 🔲 not started | 0 |
| `?force_status=N` error simulation | 🔲 not started | 0 |
| `?delay=N` slow-response handling | 🔲 not started | 0 |

## Legend

✅ done · 🟡 partial · 🔲 not started · - not applicable

## Conventions

- A resource's row is marked ✅ only when every TC in the corresponding spec file is green on a real test run (not just written). Same "Written is not done" rule as the backlog.
- "Schema" column applies only to resources where a single zod-validated spec has been adopted (per `tests/api/CLAUDE.md` decision #3: one demo spec on `POST /users`).
- "Security" column means auth-gate coverage of write verbs (no-token + invalid-token EP classes). Per-token isolation is not actively verified (would need a second token); documented as a property where relevant.
