/**
 * Escape a user-supplied string so it can be embedded safely inside a RegExp
 * pattern (e.g. for MongoDB `$regex` queries). Backslash-escapes every char
 * that has special meaning in JS/Mongo regex syntax, preventing regex injection.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
