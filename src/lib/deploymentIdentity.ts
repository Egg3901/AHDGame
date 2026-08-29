/**
 * Which deployment this process is — the one thing a database restore cannot
 * carry with it.
 *
 * Railway sets `RAILWAY_SERVICE_NAME` per service ("Main Site", "Sandbox
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
/**
 * Pairs already reported. A suppressed world posts on nearly every turn, and a
 * sandbox replaying thousands of turns would otherwise bury its own logs in the
 * same line. One line names the mismatch; repeats add nothing.
 */
const reportedSuppressions = new Set<string>();

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
