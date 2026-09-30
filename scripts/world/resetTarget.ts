import { resolveMongoDbName } from "../../src/lib/mongodb";

/** Destructive CLI and runtime helpers must address the same explicitly checked world. */
export function resolveResetTarget(
  env: Parameters<typeof resolveMongoDbName>[0],
  args: readonly string[]
): string {
  const assertions = args.filter((arg) => arg.startsWith("--expect-db="));
  if (assertions.length !== 1 || !assertions[0].slice("--expect-db=".length).trim())
    throw new Error("Reset requires one --expect-db=<database> target assertion");
  const expected = assertions[0].slice("--expect-db=".length).trim();
  const selected = resolveMongoDbName(env);
  if (expected !== selected)
    throw new Error(`Reset database mismatch: expected ${expected}, configured ${selected}`);
  return selected;
}
