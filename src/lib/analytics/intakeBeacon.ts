"use client";

/**
 * Browser side of the anonymous intake events (see `intakeEvents.ts`).
 * Fire-and-forget: a failed beacon never surfaces to the player.
 */
export type IntakeBeaconEvent =
  | "landing_viewed"
  | "landing_cta_clicked"
  | "signup_viewed"
  | "signup_started"
  | "create_character_viewed"
  | "intake_blocked"
  | "create_character_load_failed"
  | "create_character_submit_failed";

export interface IntakeBeaconProperties {
  surface?: "landing" | "register" | "login" | "create_character";
  cta?: "register" | "login" | "discord" | "play_free" | "wiki";
  method?: "email" | "google" | "discord" | "apple";
  reason?: string;
  step?: string;
}

const sentOnce = new Set<string>();

export function sendIntakeBeacon(
  event: IntakeBeaconEvent,
  properties: IntakeBeaconProperties = {}
) {
  try {
    // fetch with keepalive survives a navigation the same way sendBeacon does.
    void fetch("/api/analytics/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, ...properties }),
      keepalive: true,
      // Telemetry is best-effort and never surfaces to the player or the error tracker.
      // eslint-disable-next-line local/no-silent-fetch-catch
    }).catch(() => {});
  } catch {
    // Telemetry never affects intake.
  }
}

/** Send an event at most once per page lifetime for the given key. */
export function sendIntakeBeaconOnce(
  key: string,
  event: IntakeBeaconEvent,
  properties: IntakeBeaconProperties = {}
) {
  if (sentOnce.has(key)) return;
  sentOnce.add(key);
  sendIntakeBeacon(event, properties);
}

/** Map a free-form server error message to a short enumerated reason token. */
export function classifyCreateCharacterError(status: number, message: string): string {
  if (status === 503) return "closed_maintenance";
  if (status === 401) return "unauthenticated";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  const m = message.toLowerCase();
  if (m.includes("name")) return "invalid_name";
  if (m.includes("party")) return "invalid_party";
  if (m.includes("state") || m.includes("region")) return "invalid_home";
  if (m.includes("stat")) return "invalid_stats";
  return "rejected";
}
