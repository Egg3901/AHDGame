import { isDecadeReached } from "@/lib/constants/techTree/decades";
import { getProductKind } from "./catalog";
import { DEFAULT_PRODUCT_LIFECYCLE_SCHEDULE, type ProductLifecycleSchedule } from "./lifecycle";
import type { MediaOperatingModel } from "./types";

/**
 * Media & Entertainment content rules (issues #2234/#2237).
 *
 * Pure rules: which operating model can build which content kind, on what
 * cadence, with what coverage, behind which era/technology gate, and with
 * what catalog tail. Only outputs already modeled by the commodity system
 * appear here (advertising, entertainment_services); nothing here may
 * introduce a new commodity.
 *
 * Technology ids are real tech-tree nodes (`<sector>-<decade>-<slot>`, slots
 * are 1-based within the decade lane):
 * - media-1940-1 "Radio Network Dominance"
 * - media-1950-1 "Television Broadcasting"
 * - media-2009-1 "Streaming Platforms" (unlocks the streaming_media strategy)
 * - entertainment-1940-1 "Hollywood Studio System"
 * - entertainment-1950-2 "Record Labels"
 * - entertainment-1960-1 "Concert Touring"
 * - entertainment-2009-1 "Streaming Distribution"
 *
 * Coverage is audience reach, not market share and not quality. It sizes the
 * addressable launch audience for a model and is deliberately never fed into
 * the clearing seams: demand and price effects ride the shared lifecycle
 * multipliers only, so coverage cannot duplicate commodity demand.
 */

export type MediaCorporationType = "media" | "entertainment";

export type MediaCoveragePattern =
  | "print_circulation"
  | "retail_distribution"
  | "broadcast"
  | "theatrical"
  | "subscription"
  | "venue";

export interface MediaCoverageProfile {
  pattern: MediaCoveragePattern;
  /**
   * Addressable launch-audience share, in basis points (0-10000). A print
   * edition reaches its metro circulation; a national broadcast reaches most
   * households with a receiver.
   */
  addressableShareBp: number;
  blurb: string;
}

export interface MediaModelProfile {
  model: MediaOperatingModel;
  /** Corporation sector types that may own this operating model. */
  corporationTypes: readonly MediaCorporationType[];
  coverage: MediaCoverageProfile;
  /** Era floor; absent means producible in any era. */
  minDecade?: string;
  /**
   * Anchor research per corporation lane. A model is technology-gated only
   * for lanes listed here; unlisted lanes (and gateless models) need no
   * research. Lanes differ because each corporation researches its own
   * sector tree: a media corporation cannot unlock entertainment nodes.
   */
  technologyIdBySector?: Partial<Record<MediaCorporationType, string>>;
  /** One-line Studio explanation of the model's cadence. */
  cadenceBlurb: string;
  /** One-line Studio explanation of the model's tail behavior. */
  tailBlurb: string;
}

const MODEL_PROFILES: readonly MediaModelProfile[] = [
  {
    model: "newspaper",
    corporationTypes: ["media"],
    coverage: {
      pattern: "print_circulation",
      addressableShareBp: 1500,
      blurb: "Metro print circulation: a daily edition reaches about 15% of households.",
    },
    cadenceBlurb: "Daily editions develop in 2 turns and turn over fast.",
    tailBlurb: "No catalog tail: yesterday's edition is fishwrap.",
  },
  {
    model: "publishing_house",
    corporationTypes: ["media", "entertainment"],
    coverage: {
      pattern: "retail_distribution",
      addressableShareBp: 2000,
      blurb: "Book-trade distribution: a release reaches about 20% of readers.",
    },
    cadenceBlurb: "Books develop over 8 turns of editing, printing, and publicity.",
    tailBlurb: "Deep catalog tail: backlist sells for years.",
  },
  {
    model: "television_network",
    corporationTypes: ["media"],
    coverage: {
      pattern: "broadcast",
      addressableShareBp: 8000,
      blurb: "National broadcast: a series reaches about 80% of households.",
    },
    minDecade: "1950",
    technologyIdBySector: { media: "media-1950-1" },
    cadenceBlurb: "Series develop over 6 turns of production and scheduling.",
    tailBlurb: "Catalog tail: syndication reruns pay for years.",
  },
  {
    model: "radio_network",
    corporationTypes: ["media"],
    coverage: {
      pattern: "broadcast",
      addressableShareBp: 5000,
      blurb: "National radio: a show reaches about 50% of listeners.",
    },
    minDecade: "1940",
    technologyIdBySector: { media: "media-1940-1" },
    cadenceBlurb: "Shows develop in 3 turns of lineup and sponsor sales.",
    tailBlurb: "Ephemeral: a broadcast airs, then it is gone.",
  },
  {
    model: "film_studio",
    corporationTypes: ["entertainment"],
    coverage: {
      pattern: "theatrical",
      addressableShareBp: 4000,
      blurb: "Theatrical circuit: a film reaches about 40% of moviegoers.",
    },
    minDecade: "1940",
    technologyIdBySector: { entertainment: "entertainment-1940-1" },
    cadenceBlurb: "Films develop over 10 turns of shooting and post-production.",
    tailBlurb: "Catalog tail: library licensing pays for years.",
  },
  {
    model: "music_label",
    corporationTypes: ["entertainment"],
    coverage: {
      pattern: "retail_distribution",
      addressableShareBp: 2500,
      blurb: "Record distribution: a release reaches about 25% of listeners.",
    },
    minDecade: "1950",
    technologyIdBySector: { entertainment: "entertainment-1950-2" },
    cadenceBlurb: "Records develop over 4 turns of sessions and pressing.",
    tailBlurb: "Catalog tail: the back catalog keeps selling.",
  },
  {
    model: "streaming_platform",
    corporationTypes: ["media", "entertainment"],
    coverage: {
      pattern: "subscription",
      addressableShareBp: 6000,
      blurb: "Subscriber base: originals reach about 60% of connected homes.",
    },
    minDecade: "2009",
    technologyIdBySector: { media: "media-2009-1", entertainment: "entertainment-2009-1" },
    cadenceBlurb: "Originals develop over 8 turns of production and platform work.",
    tailBlurb: "Catalog tail: originals anchor the library permanently.",
  },
  {
    model: "live_entertainment",
    corporationTypes: ["entertainment"],
    coverage: {
      pattern: "venue",
      addressableShareBp: 1000,
      blurb: "Venue circuit: a tour reaches about 10% of households in person.",
    },
    minDecade: "1960",
    technologyIdBySector: { entertainment: "entertainment-1960-1" },
    cadenceBlurb: "Tours develop over 6 turns of booking and rehearsal.",
    tailBlurb: "No catalog tail: the show ends when the tour ends.",
  },
];

const MODEL_PROFILE_BY_MODEL = new Map<MediaOperatingModel, MediaModelProfile>(
  MODEL_PROFILES.map((profile) => [profile.model, profile])
);

/** Operating-model profile, if it is one. */
export function mediaModelProfile(model: string): MediaModelProfile | undefined {
  return MODEL_PROFILE_BY_MODEL.get(model as MediaOperatingModel);
}

/** All operating-model profiles, in catalog order. */
export function mediaModelProfiles(): readonly MediaModelProfile[] {
  return MODEL_PROFILES;
}

/** Whether an operating model fits a corporation sector type. */
export function mediaModelFitsCorporation(model: string, corporationType: unknown): boolean {
  const profile = mediaModelProfile(model);
  return (
    profile !== undefined &&
    (corporationType === "media" || corporationType === "entertainment") &&
    (profile.corporationTypes as readonly string[]).includes(corporationType)
  );
}

/** Coverage profile for one operating model, if it is one. */
export function mediaCoverageForModel(model: string): MediaCoverageProfile | undefined {
  return mediaModelProfile(model)?.coverage;
}

/**
 * Addressable launch-audience share for one operating model (0-1).
 * Unknown models read as zero reach; values clamp to the unit interval.
 */
export function coverageAddressableShare(model: string): number {
  const bp = mediaCoverageForModel(model)?.addressableShareBp;
  if (typeof bp !== "number" || !Number.isFinite(bp)) return 0;
  return Math.min(1, Math.max(0, bp / 10000));
}

// ── Per-kind cadence and tail ────────────────────────────────────────────────

/** Catalog tail behavior: what happens after the growth stage. */
export type MediaTailBehavior = "catalog" | "ephemeral" | "none";

export interface MediaKindProfile {
  kindId: string;
  schedule: ProductLifecycleSchedule;
  tail: MediaTailBehavior;
  tailBlurb: string;
}

const KIND_PROFILES: readonly MediaKindProfile[] = [
  {
    kindId: "news_story",
    schedule: {
      developmentTurns: 2,
      launchTurns: 2,
      growthTurns: 4,
      matureTurns: 8,
      declineTurns: 4,
    },
    tail: "none",
    tailBlurb: "No tail: the edition sells on launch, then it is fishwrap.",
  },
  {
    kindId: "book",
    schedule: {
      developmentTurns: 8,
      launchTurns: 4,
      growthTurns: 12,
      matureTurns: 24,
      declineTurns: 12,
    },
    tail: "catalog",
    tailBlurb: "Backlist tail: mature and declining editions keep a bounded demand lift.",
  },
  {
    kindId: "radio_program",
    schedule: {
      developmentTurns: 3,
      launchTurns: 3,
      growthTurns: 8,
      matureTurns: 16,
      declineTurns: 6,
    },
    tail: "ephemeral",
    tailBlurb: "Short tail: the run matters, reruns barely register.",
  },
  {
    kindId: "television_show",
    schedule: {
      developmentTurns: 6,
      launchTurns: 4,
      growthTurns: 12,
      matureTurns: 24,
      declineTurns: 12,
    },
    tail: "catalog",
    tailBlurb: "Syndication tail: mature and declining series keep a bounded demand lift.",
  },
  {
    kindId: "film",
    schedule: {
      developmentTurns: 10,
      launchTurns: 4,
      growthTurns: 8,
      matureTurns: 16,
      declineTurns: 12,
    },
    tail: "catalog",
    tailBlurb: "Library tail: mature and declining films keep a bounded demand lift.",
  },
  {
    kindId: "music_release",
    schedule: {
      developmentTurns: 4,
      launchTurns: 4,
      growthTurns: 10,
      matureTurns: 20,
      declineTurns: 10,
    },
    tail: "catalog",
    tailBlurb: "Back-catalog tail: mature and declining releases keep a bounded demand lift.",
  },
  {
    kindId: "live_production",
    schedule: {
      developmentTurns: 6,
      launchTurns: 3,
      growthTurns: 6,
      matureTurns: 4,
      declineTurns: 2,
    },
    tail: "none",
    tailBlurb: "No tail: the tour ends, the revenue stops.",
  },
];

const KIND_PROFILE_BY_ID = new Map<string, MediaKindProfile>(
  KIND_PROFILES.map((profile) => [profile.kindId, profile])
);

/** Content profile for one media kind, if it is one. */
export function mediaKindProfile(kindId: string): MediaKindProfile | undefined {
  return KIND_PROFILE_BY_ID.get(kindId);
}

/**
 * Lifecycle schedule for one kind. Media content kinds use their profile;
 * every other kind reads as the shared industrial default, so the turn shell
 * can resolve schedules without branching on family.
 */
export function mediaLifecycleSchedule(kindId: string): ProductLifecycleSchedule {
  return { ...(mediaKindProfile(kindId)?.schedule ?? DEFAULT_PRODUCT_LIFECYCLE_SCHEDULE) };
}

/**
 * Whether a kind earns a catalog tail: mature and declining stages keep
 * their bounded demand lift through the existing clearing seams. Live and
 * news products retire out of a short run instead. No separate revenue leg
 * exists yet; this predicate names the policy for the Studio and the future
 * tail-revenue seam.
 */
export function hasCatalogTail(kindId: string): boolean {
  return mediaKindProfile(kindId)?.tail === "catalog";
}

// ── Start validation ─────────────────────────────────────────────────────────

export interface ValidateMediaStartInput {
  kindId: string;
  /** Owning corporation's sector type. */
  corporationType: unknown;
  /** Owned operating models. */
  operatingModels?: readonly unknown[];
  /** World year; absent disables era gating (reads as reached). */
  currentYear?: number | null;
  /** Unlocked technology ids; absent disables technology gating. */
  unlockedTechnologyIds?: readonly unknown[];
}

export type MediaStartRejectReason =
  | "unknown_product_kind"
  | "incompatible_corporation_type"
  | "incompatible_operating_model"
  | "era_locked"
  | "technology_locked";

export type ValidateMediaStartResult =
  | {
      ok: true;
      operatingModel: MediaOperatingModel;
      /** Era floor that applied, when the model has one. */
      minDecade?: string;
      /** Anchor technology that applied, when the model needs one. */
      technologyId?: string;
    }
  | { ok: false; reason: MediaStartRejectReason; message: string };

function asMediaCorporationType(value: unknown): MediaCorporationType | null {
  return value === "media" || value === "entertainment" ? value : null;
}

function normalizeModels(values: readonly unknown[] | undefined): MediaOperatingModel[] {
  if (!Array.isArray(values)) return [];
  const out: MediaOperatingModel[] = [];
  for (const value of values) {
    if (typeof value === "string" && MODEL_PROFILE_BY_MODEL.has(value as MediaOperatingModel)) {
      out.push(value as MediaOperatingModel);
    }
  }
  return [...new Set(out)];
}

/**
 * Validates a media content product start. Pure: plain data in, verdict out.
 * Checks run cheapest-first so the message names the actual blocker: kind,
 * corporation type, operating model, era, technology. Absent year or
 * technology lists read as permissive (legacy callers stay green); present
 * values gate.
 */
export function validateMediaProductStart(
  input: ValidateMediaStartInput
): ValidateMediaStartResult {
  const kind = getProductKind(input.kindId);
  if (!kind || kind.family !== "media_entertainment") {
    return {
      ok: false,
      reason: "unknown_product_kind",
      message: `Unknown media product "${input.kindId}"`,
    };
  }

  const corpType = asMediaCorporationType(input.corporationType);
  if (!corpType) {
    return {
      ok: false,
      reason: "incompatible_corporation_type",
      message: `"${kind.label}" needs a Media or Entertainment corporation`,
    };
  }

  const owned = normalizeModels(input.operatingModels);
  const fitting = (kind.operatingModels ?? []).filter((model) => {
    const profile = MODEL_PROFILE_BY_MODEL.get(model);
    return (
      profile !== undefined && owned.includes(model) && profile.corporationTypes.includes(corpType)
    );
  });
  if (fitting.length === 0) {
    const legal = (kind.operatingModels ?? []).map(
      (model) => MODEL_PROFILE_BY_MODEL.get(model)?.model ?? model
    );
    return {
      ok: false,
      reason: "incompatible_operating_model",
      message:
        `"${kind.label}" needs an owned operating model fitting this corporation` +
        (legal.length > 0 ? `: ${legal.join(", ")}` : ""),
    };
  }

  const year = input.currentYear;
  const yearUsable = typeof year === "number" && Number.isFinite(year);
  const eraReached = fitting.filter((model) => {
    const minDecade = MODEL_PROFILE_BY_MODEL.get(model)?.minDecade;
    if (!minDecade) return true;
    if (!yearUsable) return true;
    return isDecadeReached(minDecade, year);
  });
  if (eraReached.length === 0) {
    const decades = [
      ...new Set(
        fitting.map((model) => MODEL_PROFILE_BY_MODEL.get(model)?.minDecade).filter(Boolean)
      ),
    ];
    return {
      ok: false,
      reason: "era_locked",
      message: `"${kind.label}" unlocks once the world reaches the ${decades.join(" or ")}s`,
    };
  }

  const unlocked =
    input.unlockedTechnologyIds === undefined
      ? undefined
      : new Set(
          (Array.isArray(input.unlockedTechnologyIds) ? input.unlockedTechnologyIds : []).filter(
            (id): id is string => typeof id === "string"
          )
        );
  const techReached = eraReached.filter((model) => {
    const required = MODEL_PROFILE_BY_MODEL.get(model)?.technologyIdBySector?.[corpType];
    if (!required) return true;
    if (unlocked === undefined) return true;
    return unlocked.has(required);
  });
  if (techReached.length === 0) {
    return {
      ok: false,
      reason: "technology_locked",
      message: `"${kind.label}" needs research the corporation has not unlocked yet`,
    };
  }

  const model = techReached[0];
  const profile = MODEL_PROFILE_BY_MODEL.get(model);
  return {
    ok: true,
    operatingModel: model,
    ...(profile?.minDecade ? { minDecade: profile.minDecade } : {}),
    ...(profile?.technologyIdBySector?.[corpType]
      ? { technologyId: profile.technologyIdBySector[corpType] as string }
      : {}),
  };
}

/**
 * Whether a media kind is startable under at least one owned model.
 * Thin wrapper for catalog/NPP filtering; full diagnostics come from
 * validateMediaProductStart.
 */
export function mediaKindLegalForModels(args: {
  kindId: string;
  corporationType: unknown;
  operatingModels?: readonly unknown[];
  currentYear?: number | null;
  unlockedTechnologyIds?: readonly unknown[];
}): boolean {
  return validateMediaProductStart({ ...args }).ok;
}

// ── Studio explainer ─────────────────────────────────────────────────────────

/**
 * Shared Studio copy: where launch quality and product brand come from.
 * Quality starts from the corporation's sector average, grows with
 * product-specific R&D during development, and gains for relevant unlocked
 * research. Brand is the average effective delivered advertising banked
 * during development, frozen at launch; it never replaces corporation brand
 * loyalty. Both move realized demand and price posture through the existing
 * clearing seams, inside published bounds.
 */
export const MEDIA_STUDIO_EXPLAINER = {
  quality:
    "Launch quality starts from the corporation's sector average, grows with product R&D " +
    "spent during development, and gains for relevant unlocked research.",
  brand:
    "Product brand is the average effective advertising delivered during development, " +
    "frozen at launch. It never replaces corporation brand loyalty.",
  coverage:
    "Coverage is audience reach, not market share: it sizes the launch audience a " +
    "model can address. It never changes commodity demand directly.",
  tail:
    "Catalog releases keep a bounded demand lift into maturity and decline. " +
    "News and live productions do not: their run ends, then they retire.",
} as const;
