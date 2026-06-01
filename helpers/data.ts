/**
 * Test data helpers - generate random/unique values for GoRest.
 *
 * GoRest User resource needs name + email + gender + status. Generate
 * randoms here; specs compose them into payloads. Add more helpers per
 * resource as concrete needs appear; no speculative helpers.
 */

export function randomEmail(): string {
  // Millisecond timestamp + 6-char base36 suffix. Suffix prevents collision
  // when multiple workers create records in the same millisecond.
  const timestamp = Date.now();
  const suffix = Math.random().toString(36).substring(2, 8);
  return `testuser_${timestamp}_${suffix}@example.com`;
}

export function randomName(): string {
  // GoRest accepts arbitrary name strings. Prefix "Test User" so records are
  // identifiable in the sandbox if a leak ever needs manual cleanup.
  return `Test User ${Math.random().toString(36).substring(2, 8)}`;
}

export function randomString(length = 8): string {
  // While-loop concatenation: Math.random().toString(36) yields ~10-13 chars,
  // not enough for length > 13. Concatenate until target length, then truncate.
  let result = "";
  while (result.length < length) {
    result += Math.random().toString(36).substring(2);
  }
  return result.substring(0, length);
}
