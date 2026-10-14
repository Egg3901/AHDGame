import { randomUUID } from "node:crypto";
import { getServerPosthogClient } from "./serverPosthog";

/**
 * Anonymous intake telemetry.
 *
 * The consented product funnel (`captureProductEvent`) only runs for a known
 * account that accepted analytics, so it cannot see logged-out visitors, OAuth
 * signups before their first consented page, or anyone who declined. These
 * events fill that gap with counts that identify nobody: a fresh random
 * distinct id per event, no person profile, and only enumerated properties.
 * Nothing here can be joined back to an account, an email, an IP or a device,
 * which is what the privacy policy's "aggregate, non-identifying counts"
 * sentence promises.
 */
export const INTAKE_EVENTS = [
  // Page surfaces
  "signup_viewed",
  "signup_started",
  "create_character_viewed",
  // Failures and closed states
  "intake_blocked",
  "create_character_load_failed",
  "create_character_submit_failed",
  // Server-side completions (every provider, consent independent)
  "account_registered",
  "character_registered",
] as const;
export type IntakeEvent = (typeof INTAKE_EVENTS)[number];

/** Every property value is a short enumerated token or a boolean. */
export type IntakeEventProperties = Record<string, string | boolean>;

const TOKEN = /^[a-z0-9_]{1,40}$/;

/** Drop anything that is not a short lowercase token or a boolean. */
export function sanitizeIntakeProperties(
  properties: Record<string, unknown> | undefined
): IntakeEventProperties {
  const clean: IntakeEventProperties = {};
  if (!properties) return clean;
  for (const [key, value] of Object.entries(properties)) {
    if (!TOKEN.test(key)) continue;
    if (typeof value === "boolean") clean[key] = value;
    else if (typeof value === "string" && TOKEN.test(value)) clean[key] = value;
  }
  return clean;
}

/**
 * Send one anonymous intake event. Never throws and never blocks the caller
 * for longer than the flush; telemetry must not affect signup.
 */
export async function captureIntakeEvent(
  event: IntakeEvent,
  properties?: Record<string, unknown>
): Promise<void> {
  try {
    const posthog = getServerPosthogClient();
    if (!posthog) return;
    posthog.capture({
      distinctId: `intake_${randomUUID()}`,
      event,
      properties: {
        ...sanitizeIntakeProperties(properties),
        intake_anonymous: true,
        $process_person_profile: false,
        // Sent from our server, so a lookup would only locate the server.
        $geoip_disable: true,
      },
    });
    await posthog.flush();
  } catch {
    // Telemetry failures never affect intake.
  }
}

/** Which sign-in a user record was created through, for intake breakdowns. */
export function authProviderOf(
  user: Record<string, unknown> | null | undefined
): "email" | "google" | "discord" | "apple" | "unknown" {
  if (!user) return "unknown";
  if (user.password) return "email";
  if (user.googleId) return "google";
  if (user.discordId) return "discord";
  if (user.appleId) return "apple";
  return "unknown";
}

/** Coarse time from account creation to an intake milestone. */
export function accountAgeBand(createdAt: unknown, now: number = Date.now()): string {
  const created = createdAt instanceof Date ? createdAt.getTime() : NaN;
  if (!Number.isFinite(created) || created > now) return "unknown";
  const hours = (now - created) / 3_600_000;
  if (hours < 1) return "under_1h";
  if (hours < 24) return "under_24h";
  if (hours < 24 * 7) return "days_1_6";
  return "days_7_plus";
}
