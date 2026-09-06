import { z } from "zod";
import { DEFAULT_GAME_STATE_FLAGS } from "@/lib/seeds/reference/featureFlagDefaults";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";

/**
 * Anonymous aggregate telemetry ingress validation.
 *
 * This module accepts ONLY the allowlisted aggregate shape the desktop
 * reporter builds (see AHDClient
 * `apps/desktop/src/simulationStatistics.ts`). It never reads auth, account
 * ids, names, or cookies, and it never retains IPs: callers must not pass
 * request metadata in here, only the parsed body.
 *
 * Privacy properties enforced here:
 * - Strict objects everywhere: unknown keys (identifiers, names, free text,
 *   nested extras) fail validation instead of being copied through.
 * - Bounded numerics matching the client ranges; non-finite rejected.
 * - createdAt is normalized to a coarse UTC day before storage; the client's
 *   precise timestamp is discarded. No persistent device id is stored.
 * - Stored documents expire 30 days after receipt (see `RETENTION_MS`). The
 *   TTL index itself (`{ expiresAt: 1 }`, `expireAfterSeconds: 0`) is created
 *   by the registered `2026-09-06-client-statistics-ttl-index` migration,
 *   never per request.
 *
 * Receiving-proxy and access-log IP retention is deployment config, not
 * something this module can enforce; do not claim otherwise.
 */

/** Schema version stamped on every accepted report. Matches the client. */
export const REPORT_VERSION = 1 as const;

/** Collection holding sanitized aggregates. No db/types entry by design. */
export const COLLECTION_NAME = "clientSimulationStatistics" as const;

/** Maximum request body accepted by the route, in bytes. Matches the client. */
export const MAX_BODY_BYTES = 8192;

/** Maximum entries in the per-sector revenue map. Matches the client. */
export const MAX_SECTOR_ENTRIES = 32;

/** How long a stored aggregate lives before expiry. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Era allowlist: every seed era the game can actually bootstrap. */
export const ALLOWED_ERAS = ["1953", "1979", "1991", "1999", "2007", "2019", "2023"] as const;

/** Setup mode allowlist. Mirrors SingleplayerMode. */
export const ALLOWED_MODES = ["normal", "head-of-state", "worldsim"] as const;

/** Difficulty allowlist for client setup reports. */
export const ALLOWED_DIFFICULTIES = ["easy", "normal", "hard"] as const;

/**
 * Autonomy allowlist. The game defines off/v0-v4 (NppAutonomyLevel); v5 is
 * accepted as forward-tolerant for newer clients.
 */
export const ALLOWED_AUTONOMY = ["off", "v0", "v1", "v2", "v3", "v4", "v5"] as const;

/**
 * Feature-flag allowlist. Exactly the flags the game reads from game state
 * (see the worldsim config route): nothing else is recorded.
 */
export const ALLOWED_FEATURE_FLAGS = Object.entries(DEFAULT_GAME_STATE_FLAGS)
  .filter(([key, value]) => typeof value === "boolean" && key !== "nppAutonomyEnabled")
  .map(([key]) => key);
const featureFlagsSchema = z.record(z.string(), z.boolean()).superRefine((flags, context) => {
  for (const key of Object.keys(flags)) {
    if (!ALLOWED_FEATURE_FLAGS.includes(key))
      context.addIssue({ code: "custom", message: "Unknown feature flag" });
  }
});

const setupSchema = z.strictObject({
  era: z.enum(ALLOWED_ERAS),
  mode: z.enum(ALLOWED_MODES),
  difficulty: z.enum(ALLOWED_DIFFICULTIES),
  autonomy: z.enum(ALLOWED_AUTONOMY),
  featureFlags: featureFlagsSchema,
});

const sectorRevenueSchema = z
  .partialRecord(z.enum(CORPORATION_TYPES), z.number().finite().min(0).max(1e15))
  .refine((map) => Object.keys(map).length <= MAX_SECTOR_ENTRIES);

const metricsSchema = z
  .strictObject({
    nppCount: z.number().int().finite().min(0).max(1_000_000).optional(),
    nppOfficeSharePercent: z.number().finite().min(0).max(100).optional(),
    marketFillRatePercent: z.number().finite().min(0).max(100).optional(),
    corporateLossMakingSharePercent: z.number().finite().min(0).max(100).optional(),
    partyCount: z.number().int().finite().min(0).max(1_000_000).optional(),
    democracyCountryCount: z.number().int().finite().min(0).max(1_000).optional(),
    autocracyCountryCount: z.number().int().finite().min(0).max(1_000).optional(),
    corporationCount: z.number().int().finite().min(0).max(1_000_000).optional(),
    totalCorporationEmployment: z.number().int().finite().min(0).max(1e11).optional(),
    totalCorporationRevenue: z.number().finite().min(0).max(1e15).optional(),
    revenueBySector: sectorRevenueSchema.optional(),
    gdpTotal: z.number().finite().min(0).max(1e15).optional(),
    gdpPerCapita: z.number().finite().min(0).max(1e9).optional(),
    tradeVolume: z.number().finite().min(0).max(1e15).optional(),
    unemploymentRatePercent: z.number().finite().min(0).max(100).optional(),
    inflationRatePercent: z.number().finite().min(-100).max(1000).optional(),
    totalPopulation: z.number().int().finite().min(0).max(2e10).optional(),
    averageStability: z.number().finite().min(0).max(100).optional(),
    minStability: z.number().finite().min(0).max(100).optional(),
    maxStability: z.number().finite().min(0).max(100).optional(),
  })
  .refine(
    (metrics) =>
      metrics.minStability === undefined ||
      metrics.maxStability === undefined ||
      metrics.minStability <= metrics.maxStability
  );

/**
 * The exact wire shape the route accepts. `createdAt` is accepted so strict
 * mode does not reject real client reports, but its value is discarded: the
 * stored document always carries the server coarse day (see
 * {@link toStoredDocument}).
 */
export const clientStatisticsReportSchema = z.strictObject({
  version: z.literal(REPORT_VERSION),
  createdAt: z.string().min(1).max(128).optional(),
  appMajorVersion: z.number().int().finite().min(0).max(999).nullable(),
  setup: setupSchema,
  metrics: metricsSchema,
  turn: z.number().int().finite().min(0).max(1_000_000).nullable(),
});

export type ClientStatisticsReport = z.infer<typeof clientStatisticsReportSchema>;

/**
 * Sanitized aggregate as stored. Coarse dates only, no identifiers, no IP,
 * no raw client timestamp.
 */
export interface ClientSimulationStatisticsDoc {
  version: typeof REPORT_VERSION;
  /** UTC midnight of receipt day. Coarse by design. */
  createdAt: Date;
  /** createdAt + RETENTION_MS. Backed by the registered TTL migration. */
  expiresAt: Date;
  appMajorVersion: number | null;
  setup: ClientStatisticsReport["setup"];
  metrics: ClientStatisticsReport["metrics"];
  turn: number | null;
}

/** Truncate an epoch timestamp to UTC midnight. Pure. */
export function coarseDayUtc(nowMs: number): Date {
  const day = new Date(nowMs);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

/**
 * Build the stored document from an already-validated report. Drops the
 * client timestamp in favor of the server coarse day.
 */
export function toStoredDocument(
  report: ClientStatisticsReport,
  nowMs: number
): ClientSimulationStatisticsDoc {
  const createdAt = coarseDayUtc(nowMs);
  return {
    version: REPORT_VERSION,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + RETENTION_MS),
    appMajorVersion: report.appMajorVersion,
    setup: report.setup,
    metrics: report.metrics,
    turn: report.turn,
  };
}
