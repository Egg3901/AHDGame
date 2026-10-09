/**
 * Which deployment this process is — the one thing a database restore cannot
 * carry with it.
 *
 * Railway sets `RAILWAY_SERVICE_NAME` per service ("AHD Production", "AHD
 * Staging"). `RAILWAY_ENVIRONMENT_NAME` is "production" on every service in this
 * project, so it is only a fallback, and anything off Railway (a local `next
 * dev`, a script) is "local".
 */
export function deploymentServiceSlug(env: NodeJS.ProcessEnv = process.env): string {
  const slug = (env.RAILWAY_SERVICE_NAME ?? env.RAILWAY_ENVIRONMENT_NAME ?? "local")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "local";
}

/**
 * Pairs already reported. A suppressed world posts on nearly every turn, and a
 * sandbox replaying thousands of turns would otherwise bury its own logs in the
 * same line. One line names the mismatch; repeats add nothing.
 */
const reportedSuppressions = new Set<string>();

/**
 * True when this process may post to the Discord webhooks configured in
 * `gameConfig.discord*WebhookUrl`.
 *
 * Those URLs live in the DATABASE, so restoring production into another
 * deployment hands it the players' channels: #1208 saw a non-production world's
 * "First Secretary of State Established" reach World News for a world that had
 * not yet reached the office's year, with no matching post in the live database.
 * `gameConfig.discordWebhookOwnerService` records the deployment that configured
 * them; a restore cannot rewrite it, because the running deployment's identity
 * comes from the environment rather than the data.
 *
 * Unstamped config posts as before — this must never silence a live world that
 * simply has not re-saved its webhooks yet.
 */
export function ownsConfiguredWebhooks(owner: string | undefined): boolean {
  if (!owner) return true;
  const self = deploymentServiceSlug();
  if (owner === self) return true;
  const pair = `${owner} -> ${self}`;
  if (!reportedSuppressions.has(pair)) {
    reportedSuppressions.add(pair);
    console.warn(
      `[Discord] Suppressed webhook send: config is owned by "${owner}", running as "${self}". ` +
        `Further suppressions are not logged.`
    );
  }
  return false;
}

/**
 * Deployments where the solo charter waiver may apply. An allowlist, not a
 * production denylist: the live service has been renamed before ("Main Site"
 * to "AHD Production"), and a rename must leave the waiver off, not on.
 */
const SOLO_CHARTER_SERVICE_SLUGS: ReadonlySet<string> = new Set([
  "ahd-staging",
  "sandbox-staging",
  "local",
]);

/**
 * True when this deployment lets one tester found a party alone (1 to 3
 * founders instead of exactly 3). Opt-in through the dedicated
 * `AHD_SANDBOX_SOLO_CHARTER` variable, set to exactly "1" or "true", and only
 * on a known non-production service, so the variable leaking onto the live
 * game (under any name) changes nothing.
 */
export function isSoloCharterTestingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.AHD_SANDBOX_SOLO_CHARTER;
  if (flag !== "1" && flag !== "true") return false;
  return SOLO_CHARTER_SERVICE_SLUGS.has(deploymentServiceSlug(env));
}
