/**
 * Playable-region texture derivation for the 1953 preset (issue #704).
 *
 * Playable countries (US/UK/RU/DD) seed from a single NATIONAL baseline per
 * family, so every region opens byte-identical except for the sparse
 * hand-authored REGIONAL_MODIFIERS_1953 table (24 of 63 families touched).
 * Non-playables instead seed per-region derived boards, which is why the four
 * countries players actually play are the flat ones.
 *
 * Replacing the authored NATIONAL_BASELINES_1953 levels wholesale with
 * deriveCountryBoard output is NOT an option: the derived levels are a
 * mechanical inversion of outcome metrics (US household income derives to 0.0
 * against an authored 72). So this module keeps the authored LEVEL and derives
 * only the per-region TEXTURE: each region's deviation from its
 * population-weighted country mean per family, computed from the same
 * legacy regional seeds (plus the same era overlays) the metric seeders apply.
 *
 * Pipeline per country, per family:
 *   1. derive every region's board (deriveCountryBoard, year 1953, the
 *      1953-gated party roster lean). Families with no derivable source
 *      (today: the defense block, which has no legacy layer and no playable
 *      tier-4 row) carry no signal, so their deviation is 0.
 *   2. subtract the population-weighted country mean, so the texture sums to
 *      zero and the authored national level survives reseeding exactly.
 *   3. zero entries where REGIONAL_MODIFIERS_1953 has a hand-authored value:
 *      deliberate history (Mississippi society.integration -18) wins outright
 *      and must not be diluted by a mechanical category average. Zeroed cells
 *      stay exactly zero through every later step.
 *   4. center the surviving subset to its own population-weighted zero mean
 *      (zeroed cells contribute nothing, so the full-population mean is zero
 *      too), then proportionally scale the family vector so the largest
 *      deviation is +/-TEXTURE_BOUND. Scaling, never clamping: clamping one
 *      tail would shift the mean the previous step just fixed.
 *   5. round to 1 decimal (the emitted board precision) and drop exact zeros.
 *
 * SCOPE: 1953-default only. The playable anchor table carries a single 1953
 * anchor, so any other preset's texture would sit unused.
 *
 * OFFLINE USE ONLY. Feeds the codegen script whose output is committed and
 * reviewed (scripts/debug/derive-playable-region-texture-1953.ts --emit) plus
 * the determinism/staleness gate in regionalTexture1953.test.ts. Pure and
 * synchronous: committed seeds in, plain numbers out. Never reads live data.
 */
import { deriveCountryBoard } from "./deriveFamilies";
import { countryLeanFromParties, type CountryLean } from "./countryLean";
import { applyMetricPresetToMetrics, getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import { applyEra1953Adjustments } from "@/lib/seeds/reference/stateMetricsEra1953";
import { stateMetrics1953 } from "@/lib/seeds/reference/stateMetrics1953";
import { states1953 } from "@/lib/seeds/reference/states1953";
import { ukStateMetrics } from "@/lib/seeds/uk/ukStateMetrics";
import { ukRegions1953 } from "@/lib/seeds/uk/ukRegions1953";
import { ruStateMetrics } from "@/lib/seeds/ru/ruStateMetrics";
import { ruRegions1953 } from "@/lib/seeds/ru/ruRegions1953";
import { ddStateMetrics1953 } from "@/lib/seeds/dd/ddStateMetrics1953";
import { ddRegions1953 } from "@/lib/seeds/dd/ddRegions1953";
import { politicalParties } from "@/lib/seeds/reference/politicalParties";
import { ukParties } from "@/lib/seeds/uk/ukParties";
import { ruParties } from "@/lib/seeds/ru/ruParties";
import { ddParties } from "@/lib/seeds/dd/ddParties";
import { REGIONAL_MODIFIERS_1953 } from "../seeds/regionalModifiers1953";
import type { PoliticalMetricId, PoliticalMetricsCountryId } from "../types";

/** The only preset this texture is derived for (single-1953-anchor table). */
export const PLAYABLE_TEXTURE_PRESET = "1953-default";
/** In-game year the legacy values are scored against (era-aware bands). */
export const PLAYABLE_TEXTURE_YEAR = 1953;
/** Largest absolute deviation any region may carry, enforced by scaling. */
export const PLAYABLE_TEXTURE_BOUND = 12;

export type RegionTexture = Partial<Record<PoliticalMetricId, number>>;
export type PlayableTexture = Record<PoliticalMetricsCountryId, Record<string, RegionTexture>>;

export interface TextureFamilyDiagnostic {
  familyId: PoliticalMetricId;
  /** max |deviation| before scaling; 0 means the family is uniform. */
  rawMaxAbs: number;
  /** Proportional scale applied (1 = no scaling needed). */
  scale: number;
  /** Regions zeroed because a hand-authored modifier wins there. */
  modifierZeroed: number;
  regionsTextured: number;
}

export interface TextureCountryDiagnostic {
  countryId: PoliticalMetricsCountryId;
  lean: CountryLean | null;
  regions: number;
  /** Families with no derivable source (defense: no legacy layer). */
  unauthored: PoliticalMetricId[];
  /** Families whose derived values actually differ across regions. */
  varyingFamilies: number;
  families: TextureFamilyDiagnostic[];
}

/** `{ category: { metricId: { value } } }` → `{ "category.metricId": value }`. */
function flatten(doc: Record<string, unknown>): Record<string, number> {
  const flat: Record<string, number> = {};
  for (const [category, metrics] of Object.entries(doc)) {
    if (typeof metrics !== "object" || metrics == null) continue;
    for (const [metricId, mv] of Object.entries(metrics as Record<string, unknown>)) {
      const v = (mv as { value?: number })?.value;
      if (typeof v === "number" && Number.isFinite(v)) flat[`${category}.${metricId}`] = v;
    }
  }
  return flat;
}

const BASE_DOCS: Record<PoliticalMetricsCountryId, Array<Record<string, unknown>>> = {
  US: stateMetrics1953 as unknown as Array<Record<string, unknown>>,
  UK: ukStateMetrics as unknown as Array<Record<string, unknown>>,
  RU: ruStateMetrics as unknown as Array<Record<string, unknown>>,
  DD: ddStateMetrics1953 as unknown as Array<Record<string, unknown>>,
};

const PARTY_ROSTERS: Record<PoliticalMetricsCountryId, readonly unknown[]> = {
  US: politicalParties,
  UK: ukParties,
  RU: ruParties,
  DD: ddParties,
};

const REGION_SEEDS: Record<
  PoliticalMetricsCountryId,
  ReadonlyArray<{ _id: string; population?: number }>
> = {
  US: states1953,
  UK: ukRegions1953,
  RU: ruRegions1953,
  DD: ddRegions1953,
};

/**
 * Per-country legacy-doc constructors. The UK base bundle needs the seeder's
 * era adjustments applied (as seedUKStateMetrics does); the other bundles
 * already carry them. Keyed record, not a country-literal branch.
 */
const LEGACY_DOC_BUILDERS: Record<
  PoliticalMetricsCountryId,
  (raw: Record<string, unknown>) => Record<string, unknown>
> = {
  US: (raw) => raw,
  UK: (raw) => applyEra1953Adjustments(raw as never) as unknown as Record<string, unknown>,
  RU: (raw) => raw,
  DD: (raw) => raw,
};

/**
 * The authoritative legacy regional seed for one region at 1953-default:
 * the base bundle with the seeder's era adjustments and metric-preset overlay
 * applied, exactly as seedRegionMetrics / seedUKStateMetrics /
 * seedRUStateMetrics / seedDDStateMetrics construct it.
 */
function legacyFlatFor(
  countryId: PoliticalMetricsCountryId,
  raw: Record<string, unknown>
): Record<string, number> {
  let doc = LEGACY_DOC_BUILDERS[countryId](raw);
  const overlay = getRegionMetricPresets(countryId, String(raw._id), PLAYABLE_TEXTURE_PRESET);
  if (overlay) {
    doc = applyMetricPresetToMetrics(doc as never, overlay) as unknown as Record<string, unknown>;
  }
  return flatten(doc);
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function deriveOneCountry(countryId: PoliticalMetricsCountryId): {
  texture: Record<string, RegionTexture>;
  diagnostic: TextureCountryDiagnostic;
} {
  const lean = countryLeanFromParties(
    PARTY_ROSTERS[countryId] as Parameters<typeof countryLeanFromParties>[0],
    PLAYABLE_TEXTURE_PRESET
  );
  const populations = new Map(REGION_SEEDS[countryId].map((s) => [s._id, s.population ?? 0]));

  // region -> family -> derived board value (only families with a source).
  const derived = new Map<string, Map<PoliticalMetricId, number>>();
  const unauthored = new Set<PoliticalMetricId>();
  for (const raw of BASE_DOCS[countryId]) {
    const regionId = String(raw._id);
    const flat = legacyFlatFor(countryId, raw);
    const board = deriveCountryBoard({
      countryId,
      legacy: flat,
      macro: flat,
      lean,
      year: PLAYABLE_TEXTURE_YEAR,
    });
    for (const u of board.unauthored) unauthored.add(u as PoliticalMetricId);
    // Regions with unauthored families are KEPT: the derived families still
    // carry signal, and the unauthored ones (defense for playables) simply
    // contribute no texture. Dropping the region would discard 56 good
    // families to protect 7 with no signal.
    const byFamily = new Map<PoliticalMetricId, number>();
    for (const [familyId, fam] of Object.entries(board.values)) {
      byFamily.set(familyId as PoliticalMetricId, fam.value);
    }
    derived.set(regionId, byFamily);
  }

  const regionIds = [...derived.keys()];
  const totalPop = regionIds.reduce((n, r) => n + (populations.get(r) ?? 0), 0);
  const weightOf = (r: string) => populations.get(r) ?? 0;
  const weight = totalPop > 0 ? weightOf : () => 1;
  const denom = regionIds.reduce((n, r) => n + weight(r), 0);

  const modifiers = REGIONAL_MODIFIERS_1953[countryId];
  const texture: Record<string, RegionTexture> = {};
  const families: TextureFamilyDiagnostic[] = [];
  let varyingFamilies = 0;

  // Every family derived in EVERY region. A family missing anywhere carries
  // no comparable signal, so it is excluded from texture (deviation 0) rather
  // than averaged against a fabricated zero. Defense never derives for
  // playables (no legacy layer, no playable tier-4 row), so it is absent here.
  const familyRegionCount = new Map<PoliticalMetricId, number>();
  for (const byFamily of derived.values()) {
    for (const fid of byFamily.keys()) {
      familyRegionCount.set(fid, (familyRegionCount.get(fid) ?? 0) + 1);
    }
  }
  const familyIds = new Set<PoliticalMetricId>();
  for (const [fid, n] of familyRegionCount) {
    if (n === regionIds.length) familyIds.add(fid);
    else unauthored.add(fid);
  }
  for (const familyId of [...familyIds].sort()) {
    const raw = regionIds.map((r) => derived.get(r)!.get(familyId) ?? 0);
    const mean = regionIds.reduce((n, r, i) => n + weight(r) * raw[i], 0) / denom;
    if (Math.max(...raw.map((v) => Math.abs(v - mean))) > 1e-9) varyingFamilies++;

    // Hand-authored modifiers win outright: zeroed cells stay exactly zero
    // through every step below, and the centering mean is taken over the
    // surviving subset only. The full-population weighted mean of the emitted
    // vector is still exactly zero (zeroed cells contribute nothing), so the
    // authored national level survives reseeding exactly where texture applies
    // — while a modifier cell carries its deliberate history undiluted.
    const active = regionIds.map((r) => modifiers[r]?.[familyId] === undefined);
    const activeDenom = regionIds.reduce((n, r, i) => n + (active[i] ? weight(r) : 0), 0);
    const subMean =
      activeDenom > 0
        ? regionIds.reduce((n, r, i) => n + (active[i] ? weight(r) * raw[i] : 0), 0) / activeDenom
        : 0;
    const dev = regionIds.map((r, i) => (active[i] ? raw[i] - subMean : 0));
    // Proportional scale to the bound, never a clamp: clamping one tail
    // would shift the zero mean the previous step just fixed (0 * scale is
    // still 0, so zeroed cells are unaffected).
    const maxAbs = Math.max(0, ...dev.map((d) => Math.abs(d)));
    const scale = maxAbs > PLAYABLE_TEXTURE_BOUND ? PLAYABLE_TEXTURE_BOUND / maxAbs : 1;

    const diag: TextureFamilyDiagnostic = {
      familyId,
      rawMaxAbs: round1(Math.max(0, ...regionIds.map((r, i) => Math.abs(raw[i] - mean)))),
      scale: Math.round(scale * 1e6) / 1e6,
      modifierZeroed: active.filter((a) => !a).length,
      regionsTextured: 0,
    };
    regionIds.forEach((r, i) => {
      const v = round1(dev[i] * scale);
      if (v !== 0) {
        (texture[r] ??= {})[familyId] = v;
        diag.regionsTextured++;
      }
    });
    families.push(diag);
  }

  return {
    texture,
    diagnostic: {
      countryId,
      lean,
      regions: regionIds.length,
      unauthored: [...unauthored].sort() as PoliticalMetricId[],
      varyingFamilies,
      families,
    },
  };
}

/**
 * Derive the full 1953 playable-region texture plus per-country diagnostics.
 * Deterministic: sorted family iteration, no randomness, no clock, no I/O.
 */
export function derivePlayableTexture1953(): {
  texture: PlayableTexture;
  diagnostics: TextureCountryDiagnostic[];
} {
  const texture = {} as PlayableTexture;
  const diagnostics: TextureCountryDiagnostic[] = [];
  for (const countryId of ["US", "UK", "RU", "DD"] as const) {
    const { texture: t, diagnostic } = deriveOneCountry(countryId);
    texture[countryId] = t;
    diagnostics.push(diagnostic);
  }
  return { texture, diagnostics };
}
