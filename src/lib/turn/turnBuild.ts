/**
 * The deployed source a turn ran on. Stamped on every turn log so turn
 * timings can be attributed to the exact release that produced them, instead
 * of being inferred from deploy times.
 */
export interface TurnBuild {
  /** Full or abbreviated lowercase git commit SHA of the running deployment. */
  commit: string;
}

/** Read the deployed commit from the hosting environment, if it is known. */
export function currentTurnBuild(
  env: Record<string, string | undefined> = process.env
): TurnBuild | undefined {
  const raw = env.RAILWAY_GIT_COMMIT_SHA ?? env.BUILD_GIT_COMMIT_SHA;
  const commit = raw?.trim().toLowerCase();
  return commit && /^[0-9a-f]{7,40}$/.test(commit) ? { commit } : undefined;
}
