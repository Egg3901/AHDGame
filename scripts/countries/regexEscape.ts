/**
 * Escape a value being interpolated into a `new RegExp(...)`.
 *
 * ⚠️ EVERY TOOL HERE BUILDS PATTERNS OUT OF STRINGS, AND TWO OF THEM WERE WRONG
 * IN A WAY THAT MATTERED, not merely flagged. `ensureImport` escaped `/` and
 * nothing else, so the `.` in a module path like `@/lib/countries/de` stayed a
 * wildcard and the "is this already imported" test matched paths it should not
 * have. The forwarding check had the same shape: `(@/lib|\.)` written inside a
 * TEMPLATE LITERAL, where `\.` collapses to a bare `.`, so the alternation
 * matched any single character instead of a literal dot.
 *
 * ⚠️ `\/` IS NOT AN ESCAPE HERE. A forward slash only needs escaping inside a
 * regex LITERAL, where it would end the pattern. In a `RegExp` built from a
 * string it is an ordinary character, and `"\\/"` is a useless escape that
 * looks like sanitising while doing nothing.
 *
 * The values these tools interpolate are country codes and module paths from
 * `process.argv`, so the practical risk is a wrong match rather than an attack
 * -- but a wrong match in a codemod rewrites the wrong line, which is worse.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
