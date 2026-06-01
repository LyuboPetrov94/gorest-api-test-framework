import { z } from "zod";

// Single resource schema. GoRest returns bare User objects (no envelope), so
// there's no Create/Get envelope wrapping like the prior project's Notes API
// had. The .strict() mode means unknown keys fail validation - this is the
// regression net that catches "server silently added a field" changes.
//
// Bounds and enums encode the validators discovered in users-validation:
//  - name 1-200 chars (per "name length BVA" block + server error message)
//  - gender only male/female (per gotcha catalogue)
//  - status only active/inactive (per gotcha catalogue)
export const UserSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(200),
    email: z.string().email(),
    gender: z.enum(["male", "female"]),
    status: z.enum(["active", "inactive"]),
  })
  .strict();

// List endpoint returns a bare array of User objects. Each element is
// validated against the strict UserSchema, so a server-added field on ANY
// list item (including the shared seed data) fails the schema.
export const UserListSchema = z.array(UserSchema);
