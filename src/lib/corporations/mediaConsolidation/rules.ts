import type { CorporationType } from "@/lib/constants/corporations";
import { MEDIA_OPERATING_MODELS, type MediaOperatingModel } from "@/lib/products/types";

/**
 * Media & Entertainment taxonomy consolidation (issue #2234), pure rules.
 *
 * `media_entertainment` is the sole runtime corporation/sector type for this
 * domain. The retired `media` / `entertainment` labels exist only at the
 * migration/input boundary: recognize them there, canonicalize immediately,
 * never persist or emit them.
 *
 * Plain data in, plain data out. No DB, clock, randomness, or env. The
 * Mongo shell that applies these plans lives in `migrate.ts` beside this
 * file; every planner here is idempotent (rerunning over canonical data is
 * a no-op) so a crashed migration can simply run again.
 */

/** Sole runtime corporation/sector type for the media & entertainment domain. */
export const MEDIA_ENTERTAINMENT_SECTOR_TYPE = "media_entertainment";

/** Retired sector labels. Recognized at the boundary, never authored. */
export const LEGACY_MEDIA_SECTOR_TYPES = ["media", "entertainment"] as const;

export type LegacyMediaSectorType = (typeof LEGACY_MEDIA_SECTOR_TYPES)[number];

/**
 * Input-boundary vocabulary: the runtime type plus the retired labels.
 * Seed maps and old API payloads may carry the legacy members; runtime
 * tables and new writes must not.
 */
export type MediaSectorTypeInput = CorporationType | LegacyMediaSectorType;

/** True for the two retired labels only (not the canonical type). */
export function isLegacyMediaSectorType(value: unknown): value is LegacyMediaSectorType {
  return value === "media" || value === "entertainment";
}

/** True for the canonical type or either retired label. */
export function isMediaEntertainmentSectorType(value: unknown): boolean {
  return value === MEDIA_ENTERTAINMENT_SECTOR_TYPE || isLegacyMediaSectorType(value);
}

/**
 * Canonicalize one sector-type value. Returns the canonical type for the
 * canonical value and both retired labels, null for anything else.
 */
export function canonicalizeMediaSectorType(value: unknown): typeof MEDIA_ENTERTAINMENT_SECTOR_TYPE | null {
  return isMediaEntertainmentSectorType(value) ? MEDIA_ENTERTAINMENT_SECTOR_TYPE : null;
}

/**
 * Boundary canonicalizer for whole values (zod preprocess, seed readers,
 * API ingestion). Legacy labels become the canonical type; every other
 * value passes through untouched so unrelated types never remap.
 */
export function canonicalizeSectorTypeInput<T>(value: T): T | typeof MEDIA_ENTERTAINMENT_SECTOR_TYPE {
  return isLegacyMediaSectorType(value)
    ? (MEDIA_ENTERTAINMENT_SECTOR_TYPE as T | typeof MEDIA_ENTERTAINMENT_SECTOR_TYPE)
    : value;
}

// ─── Canonical strategy catalog ─────────────────────────────────────────────
// One catalog for newspaper, publishing, radio, television, film, recorded
// music, streaming, and live entertainment operating models. Rates live in
// SECTOR_STRATEGIES[media_entertainment]; only the ids live here so the
// migration can remap old rows without importing the balance tables.

export const CANONICAL_MEDIA_STRATEGIES = [
  "standard",
  "press",
  "broadcast",
  "screen",
  "studio",
  "streaming",
  "live_venue",
  "diversified",
] as const;

export type CanonicalMediaStrategy = (typeof CANONICAL_MEDIA_STRATEGIES)[number];

/** Collision merges always land here: the merged row is every model at once. */
export const DIVERSIFIED_MEDIA_STRATEGY: CanonicalMediaStrategy = "diversified";

/**
 * Legacy strategy id to canonical strategy id. Keyed by the OLD id alone:
 * both legacy `standard` strategies collapse to one `standard`, and no
 * entry records which sector the old id came from.
 */
const LEGACY_MEDIA_STRATEGY_MAP: Record<string, CanonicalMediaStrategy> = {
  standard: "standard",
  streaming_media: "streaming",
  digital_first: "streaming",
  legacy_broadcast: "broadcast",
  streaming: "streaming",
  live_service: "streaming",
  live_venue: "live_venue",
};

/**
 * Map any strategy id found on a legacy media/entertainment row to the
 * canonical catalog. Canonical ids pass through unchanged (reruns are
 * no-ops); unknown ids fall back to `standard`, the catalog default.
 */
export function canonicalMediaStrategyForLegacy(strategyId: unknown): CanonicalMediaStrategy {
  if (typeof strategyId !== "string") return "standard";
  if ((CANONICAL_MEDIA_STRATEGIES as readonly string[]).includes(strategyId)) {
    return strategyId as CanonicalMediaStrategy;
  }
  return LEGACY_MEDIA_STRATEGY_MAP[strategyId] ?? "standard";
}

// ─── Operating-model inference ──────────────────────────────────────────────
// Inferred from each old type BEFORE it is erased; a collision receives the
// union. Mirrors the model profiles in lib/products/media.ts.

const MEDIA_OPERATING_MODELS_BY_LEGACY_TYPE: Record<
  LegacyMediaSectorType,
  readonly MediaOperatingModel[]
> = {
  media: ["newspaper", "publishing_house", "television_network", "radio_network", "streaming_platform"],
  entertainment: [
    "film_studio",
    "music_label",
    "streaming_platform",
    "live_entertainment",
    "publishing_house",
  ],
};

const KNOWN_OPERATING_MODELS = new Set<string>(MEDIA_OPERATING_MODELS);

/** Default operating models inferred from one retired sector label. */
export function inferredOperatingModelsForLegacyType(
  sectorType: LegacyMediaSectorType
): MediaOperatingModel[] {
  return [...MEDIA_OPERATING_MODELS_BY_LEGACY_TYPE[sectorType]];
}

/**
 * Union of inferred models over legacy types, in MEDIA_OPERATING_MODELS
 * order. Unknown inputs contribute nothing; duplicates collapse.
 */
export function unionInferredOperatingModels(types: readonly unknown[]): MediaOperatingModel[] {
  const union = new Set<MediaOperatingModel>();
  for (const type of types) {
    if (!isLegacyMediaSectorType(type)) continue;
    for (const model of MEDIA_OPERATING_MODELS_BY_LEGACY_TYPE[type]) union.add(model);
  }
  return (MEDIA_OPERATING_MODELS as readonly string[]).filter((model): model is MediaOperatingModel =>
    union.has(model as MediaOperatingModel)
  );
}

/** Drop unknown model names from a persisted list (forward-tolerant read). */
export function sanitizeOperatingModels(models: readonly unknown[]): MediaOperatingModel[] {
  const out: MediaOperatingModel[] = [];
  for (const model of models) {
    if (typeof model === "string" && KNOWN_OPERATING_MODELS.has(model)) {
      out.push(model as MediaOperatingModel);
    }
  }
  return [...new Set(out)];
}

// ─── Technology unlock consolidation ────────────────────────────────────────
// Old lanes were positional (`<type>-<decade>-<slot>`); the canonical lane
// concatenates both, so the caller supplies the positional remap and this
// stays a pure set operation: remap recognized legacy ids, pass through
// corporate-lane and already-canonical ids, never duplicate.

/** Remap one persisted tech node id to the canonical lane, or null to keep. */
export type LegacyTechIdMapper = (nodeId: string) => string | null;

/**
 * Consolidate one corporation's unlocked tech ids onto the canonical lane.
 * Earned unlocks survive (remapped, deduplicated); corporate-lane and
 * already-canonical ids pass through; order is stable (first-seen wins).
 */
export function consolidateMediaTechUnlocks(
  unlockedTechNodeIds: readonly unknown[] | undefined | null,
  mapLegacyId: LegacyTechIdMapper
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of unlockedTechNodeIds ?? []) {
    if (typeof raw !== "string" || raw.length === 0) continue;
    const mapped = mapLegacyId(raw) ?? raw;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  return out;
}

// ─── Weight-map canonicalization (seed ingestion boundary) ─────────────────

/**
 * Fold legacy keys of a sector-weight map into the canonical key. Weights
 * are shares normalized downstream, so summing preserves every other
 * sector's share exactly. Non-legacy keys pass through by reference value.
 */
export function canonicalizeSectorWeightMap<T extends Partial<Record<string, number | null | undefined>>>(
  weights: T
): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = {};
  let merged = 0;
  let hasMerged = false;
  for (const [key, value] of Object.entries(weights)) {
    if (key === "media" || key === "entertainment") {
      if (typeof value === "number" && Number.isFinite(value)) {
        merged += value;
        hasMerged = true;
      }
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  const existing = (weights as Partial<Record<string, unknown>>)[MEDIA_ENTERTAINMENT_SECTOR_TYPE];
  if (typeof existing === "number" && Number.isFinite(existing)) {
    merged += existing;
    hasMerged = true;
  }
  if (hasMerged) out[MEDIA_ENTERTAINMENT_SECTOR_TYPE] = merged;
  return out;
}

// ─── Corporation document plan ─────────────────────────────────────────────

export interface CorporationTypeMigrationPlan {
  type: string;
  secondaryType: string | null;
  /** True when either field actually changes (idempotency discriminator). */
  changed: boolean;
}

/**
 * Canonicalize a corporation's primary/secondary types. A secondary that
 * canonicalizes onto the primary is cleared: a focus equal to the primary
 * is meaningless, and the common legacy shape (primary media + secondary
 * entertainment, or the reverse) always lands there.
 */
export function planCorporationTypeMigration(
  type: unknown,
  secondaryType: unknown
): CorporationTypeMigrationPlan {
  const nextType = isMediaEntertainmentSectorType(type)
    ? MEDIA_ENTERTAINMENT_SECTOR_TYPE
    : type;
  const nextSecondaryRaw = isMediaEntertainmentSectorType(secondaryType)
    ? MEDIA_ENTERTAINMENT_SECTOR_TYPE
    : secondaryType;
  const nextSecondary =
    typeof nextSecondaryRaw === "string" && nextSecondaryRaw !== nextType ? nextSecondaryRaw : null;
  const prevSecondary = typeof secondaryType === "string" ? secondaryType : null;
  return {
    type: nextType as string,
    secondaryType: nextSecondary,
    changed: nextType !== type || nextSecondary !== prevSecondary,
  };
}
