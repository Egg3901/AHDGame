/**
 * Discord alerting for fatal production errors.
 *
 * Sends a webhook message to a Discord channel when Sentry captures a fatal
 * error. This gives us real-time pings for critical failures without watching
 * the GlitchTip dashboard.
 *
 * Configure with the `DISCORD_ALERT_WEBHOOK_URL` env var. If unset, alerts are
 * skipped silently — no crash, no noise.
 */
import * as Sentry from "@sentry/nextjs";

/** Minimum severity that triggers a Discord alert. */
const ALERT_LEVEL: Sentry.SeverityLevel = "fatal";

/**
 * Send a Discord alert for a fatal error. Fire-and-forget — never blocks the
 * request or throws if Discord is unreachable.
 *
 * @param error    - The error that was captured.
 * @param context  - Optional tags/extra from the capture site.
 */
export function alertOps(
  error: unknown,
  context?: {
    tags?: Record<string, string | number | boolean>;
    extra?: Record<string, unknown>;
    level?: Sentry.SeverityLevel;
  }
): void {
  const level = context?.level ?? "error";
  if (level !== ALERT_LEVEL && level !== "fatal") return;

  // Read at call time so tests can set env vars after import.
  const webhookUrl = process.env.DISCORD_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const message = error instanceof Error ? error.message : String(error);
  const tags = context?.tags ?? {};
  const tagStr = Object.entries(tags)
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");

  const payload = {
    embeds: [
      {
        title: "🚨 Fatal Error",
        description: `\`\`\`\n${message.slice(0, 1500)}\n\`\`\``,
        color: 0xff0000,
        fields: [
          {
            name: "Tags",
            value: tagStr || "none",
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  void fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => {
    // Swallow — Discord alerting must never break the request. Log to the
    // server console only (never GlitchTip: this IS the alerting path).
    console.error("ops alert webhook delivery failed", err);
  });
}
