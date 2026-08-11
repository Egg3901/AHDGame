import type { Db } from "mongodb";
import { forbidden } from "@/lib/api/errors";
import { getRegistrationIpMatchCandidates, normalizeIp } from "@/lib/utils/ipNormalize";
import { LEGACY_FINGERPRINT_LENGTH } from "@/lib/utils/fingerprint";
import { isCgnatProneDevice, type DeviceClass } from "@/lib/utils/userAgent";
import type { BannedIp, GameConfig, User } from "@/lib/db/types";

interface RegistrationSignals {
  clientIp: string;
  fingerprint?: string | null;
  trackingId?: string | null;
  deviceKey?: string | null;
  /** Device class derived from the request's User-Agent; defaults to `desktop`. */
  device?: DeviceClass | null;
}

/**
 * Outcome of a successful gate check. `softAllow` is populated when we let a
 * registration through despite an IP collision because the client is a
 * cgNAT-prone mobile/tablet device — callers should record this for admin
 * review so the resulting account is auditable.
 */
export interface RegistrationDecision {
  softAllow?: {
    reason: "cgnat_mobile_ip";
    sharedIp: string;
    existingCount: number;
    device: DeviceClass;
  };
}

/**
 * Build the list of fingerprint values to match against existing user docs.
 * Stored fingerprints predating the full-hash migration are 16-char prefixes
 * of the SHA-256, so we look up both the full incoming hash and its legacy
 * prefix to keep collision detection working across the rollout.
 */
export function fingerprintMatchCandidates(fingerprint: string | null | undefined): string[] {
  if (!fingerprint) return [];
  const candidates = new Set<string>([fingerprint]);
  if (fingerprint.length > LEGACY_FINGERPRINT_LENGTH) {
    candidates.add(fingerprint.slice(0, LEGACY_FINGERPRINT_LENGTH));
  }
  return Array.from(candidates);
}

/**
 * Server-side registration gate. Call at every point that creates a new
 * `users` document: /api/auth/register, and the new-user branch of
 * /api/auth/google/callback and /api/auth/discord/callback.
 *
 * Order of checks:
 *   1. Master kill-switch (gameConfig.registrationEnabled === false → block).
 *   2. IP normalization — "unknown"/unparseable values allow through (we
 *      cannot match them against any rule).
 *   3. Manual ban row → block (always applies, regardless of toggle).
 *   4. If gameConfig.ipCollisionCheckEnabled !== true, allow.
 *   5. Block exact browser-cookie / fingerprint / device-key reuse against
 *      existing users. Always blocks — these are stable per-browser signals,
 *      so a match means the same person.
 *   6. Count users whose stored registrationIp matches the normalized IP or
 *      a legacy-equivalent variant. If an allowance row exists, block when
 *      count >= maxAccounts. Otherwise: hard-block desktops on count >= 1,
 *      soft-allow mobile/tablet devices since carrier cgNAT routinely puts
 *      unrelated users behind the same IP. Soft-allows are returned to the
 *      caller so they can be logged for admin review.
 */
export async function assertRegistrationAllowed(
  db: Db,
  signals: string | RegistrationSignals
): Promise<RegistrationDecision> {
  const clientIp = typeof signals === "string" ? signals : signals.clientIp;
  const fingerprint = typeof signals === "string" ? undefined : (signals.fingerprint ?? undefined);
  const trackingId = typeof signals === "string" ? undefined : (signals.trackingId ?? undefined);
  const deviceKey = typeof signals === "string" ? undefined : (signals.deviceKey ?? undefined);
  const device: DeviceClass =
    typeof signals === "string" ? "desktop" : (signals.device ?? "desktop");
  const config = await db.collection<GameConfig>("gameConfig").findOne(
    { _id: "default" },
    {
      projection: {
        registrationEnabled: 1,
        ipCollisionCheckEnabled: 1,
      },
    }
  );

  if (config?.registrationEnabled === false) {
    throw forbidden("Registration is currently closed.");
  }

  const ip = normalizeIp(clientIp);
  const ipCandidates = ip ? getRegistrationIpMatchCandidates(clientIp) : [];

  const rule = ip ? await db.collection<BannedIp>("bannedIps").findOne({ ip }) : null;

  if (rule && rule.allowRegistration !== true) {
    throw forbidden("Registration is not available from this location.");
  }

  if (config?.ipCollisionCheckEnabled !== true) return {};

  const browserCollisionClauses: Record<string, unknown>[] = [];
  if (trackingId) {
    browserCollisionClauses.push({ trackingId });
  }
  if (deviceKey) {
    browserCollisionClauses.push({ deviceKey });
  }
  const fingerprintCandidates = fingerprintMatchCandidates(fingerprint);
  if (fingerprintCandidates.length > 0) {
    browserCollisionClauses.push(
      { registrationFingerprint: { $in: fingerprintCandidates } },
      { lastFingerprint: { $in: fingerprintCandidates } },
      { fingerprintHistory: { $in: fingerprintCandidates } }
    );
  }

  if (browserCollisionClauses.length > 0) {
    const browserCollision = await db
      .collection<User>("users")
      .findOne({ $or: browserCollisionClauses }, { projection: { _id: 1 } });
    if (browserCollision) {
      throw forbidden("An account is already registered from this browser.");
    }
  }

  if (!ipCandidates.length) return {};

  const count = await db
    .collection<User>("users")
    .countDocuments({ registrationIp: { $in: ipCandidates } });

  if (rule && rule.allowRegistration === true) {
    const max = rule.maxAccounts ?? 0;
    if (count >= max) {
      throw forbidden("Registration limit reached for this location.");
    }
    return {};
  }

  if (count >= 1) {
    // Soft-allow on mobile/tablet: carrier cgNAT routinely puts unrelated
    // users on the same public IP, so a shared-IP collision alone isn't
    // evidence of an alt — fingerprint/device-key already cleared above.
    // Desktop and unknown clients still get the hard block.
    if (isCgnatProneDevice(device)) {
      return {
        softAllow: {
          reason: "cgnat_mobile_ip",
          sharedIp: ip ?? clientIp,
          existingCount: count,
          device,
        },
      };
    }
    throw forbidden("An account is already registered from this location.");
  }

  return {};
}
