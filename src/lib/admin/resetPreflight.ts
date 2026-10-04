import { resolveMongoDbName } from "@/lib/mongodb";
import type { Env } from "@/lib/env";

type ResetDatabaseEnv = Pick<Env, "MONGODB_URI" | "MONGODB_DB">;

/** Refuse a reset target when the checked or connected database differs from the app target. */
export function assertResetDatabaseMatchesApplication(
  env: ResetDatabaseEnv,
  candidateDatabaseName: string,
  candidateLabel: "checked target" | "connected database"
): void {
  const applicationDatabaseName = resolveMongoDbName(env);
  if (candidateDatabaseName !== applicationDatabaseName) {
    throw new Error(
      `Reset database mismatch: ${candidateLabel} ${candidateDatabaseName}, application selects ${applicationDatabaseName}`
    );
  }
}
