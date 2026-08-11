import { EXTRACTABLE_RESOURCES, type CommodityType } from "@/lib/constants/commodities";

/**
 * Output quality — the four production pillars (design: /reports/brand-loyalty-plan).
 *
 *   quality = 100 · (tech^a · inputs^b · wages^c · operations^d)
 *
 * A weighted geometric mean of four sub-scores, each in [floor, 1]. The pillars
 * SUBSTITUTE rather than gate: a weak input drags quality down but enough tech,
 * wages, or operations pull it back up (a master shop makes good goods from
 * ordinary materials) — the small floor on each sub-score keeps one bad pillar
 * from collapsing quality to zero. Tech carries the largest weight.
 *
 * The four pillars map to the real pillars of manufacturing quality:
 *   - tech       — design & engineering (corp R&D / tech-node depth)
 *   - inputs     — material quality (lagged avg quality of the commodities consumed)
 *   - wages      — workforce skill/morale (wage level vs baseline)
 *   - operations — process control / QC (logistics-&-operations strength)
 *
 * Raw extraction has no quality — ore is ore — so extractable-only sectors are
 * quality-neutral (reliability, measured by loyalty, is their "quality").
 *
 * Pure: no DB, no clock. The turn layer feeds it lagged inputs and persists the
 * per-sector result + the corp/commodity rollups.
 */

// ── Weights (sum to 1; tech-led) and bounds ──────────────────────────────────
export const QUALITY_WEIGHT_TECH = 0.4;
export const QUALITY_WEIGHT_INPUTS = 0.2;
export const QUALITY_WEIGHT_WAGES = 0.2;
export const QUALITY_WEIGHT_OPERATIONS = 0.2;

/** Sub-score floor — no single pillar can drive quality below this share of its term. */
export const QUALITY_SUBSCORE_FLOOR = 0.1;

/**
 * rdScore that reads as "par" tech. Calibrated to the live distribution
 * (2026-07-06: rdScore p50≈7.7, p90≈51): at 25 the median corp lands ~0.55 and
 * a p90 R&D corp saturates ~1.0, so tech meaningfully differentiates without
 * crushing the median. (Tech-tree corps push rdScore higher; the ref still holds.)
 */
export const QUALITY_TECH_REF = 25;
/**
 * Logistics-&-Operations strength that reads as par operations. Live dist is
 * very skewed (p50≈2.9, p90≈89); 15 puts the median ~0.44 and rewards the
 * heavy operators without flooring everyone else.
 */
export const QUALITY_OPS_REF = 15;
/** How strongly wageLevel above/below 1.0 moves the wage sub-score. */
export const QUALITY_WAGE_SLOPE = 0.6;
/** Neutral input quality (0–100) used when a sector has no measurable inputs. */
export const QUALITY_NEUTRAL_INPUT = 50;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** A pillar sub-score in [floor, 1] from a raw value and its par reference (√, diminishing). */
function pillarScore(value: number, ref: number): number {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  const raw = ref > 0 ? Math.sqrt(v / ref) : 0;
  return Math.max(QUALITY_SUBSCORE_FLOOR, clamp01(raw));
}

export interface SectorQualityInput {
  /** Corp R&D score (tech pillar). */
  techScore: number;
  /** Sector wage level (1.0 = baseline); wages pillar. */
  wageLevel: number;
  /** Corp logistics-&-operations strength; operations pillar. */
  operationsStrength: number;
  /** Lagged avg quality (0–100) of the sector's INPUT commodities; inputs pillar. */
  inputQuality?: number;
  /** The commodities this sector OUTPUTS — used to detect extraction-only sectors. */
  outputCommodities: readonly CommodityType[];
}

const EXTRACTABLE_SET = new Set<string>(EXTRACTABLE_RESOURCES as readonly string[]);

/** True when every output is a raw extractable (no quality dimension). */
export function isExtractionOnly(outputs: readonly CommodityType[]): boolean {
  return outputs.length > 0 && outputs.every((c) => EXTRACTABLE_SET.has(c));
}

/**
 * Per-sector output quality, 0–100. Returns null for extraction-only sectors
 * (quality-neutral; excluded from the corp rollup). Pure.
 */
export function computeSectorQuality(input: SectorQualityInput): number | null {
  if (isExtractionOnly(input.outputCommodities)) return null;

  const tech = pillarScore(input.techScore, QUALITY_TECH_REF);
  const ops = pillarScore(input.operationsStrength, QUALITY_OPS_REF);
  // Wages: efficiency-wage — above baseline lifts, below drags, diminishing.
  const wageLevel = Number.isFinite(input.wageLevel) ? input.wageLevel : 1;
  const wage = Math.max(
    QUALITY_SUBSCORE_FLOOR,
    clamp01(0.5 + QUALITY_WAGE_SLOPE * (wageLevel - 1))
  );
  const inputQ = input.inputQuality == null ? QUALITY_NEUTRAL_INPUT : input.inputQuality;
  const inputs = Math.max(QUALITY_SUBSCORE_FLOOR, clamp01(inputQ / 100));

  const geo =
    Math.pow(tech, QUALITY_WEIGHT_TECH) *
    Math.pow(inputs, QUALITY_WEIGHT_INPUTS) *
    Math.pow(wage, QUALITY_WEIGHT_WAGES) *
    Math.pow(ops, QUALITY_WEIGHT_OPERATIONS);

  return Math.round(clamp01(geo) * 1000) / 10; // 0–100, one decimal
}

/**
 * Revenue-weighted mean quality across a corp's non-extraction sectors.
 * Returns null when the corp has no quality-bearing sectors.
 */
export function rollupCorpQuality(
  sectors: readonly { quality: number | null; revenueWeight: number }[]
): number | null {
  let w = 0;
  let acc = 0;
  for (const s of sectors) {
    if (s.quality == null) continue;
    const weight = Number.isFinite(s.revenueWeight) ? Math.max(0, s.revenueWeight) : 0;
    if (weight <= 0) continue;
    w += weight;
    acc += weight * s.quality;
  }
  if (w <= 0) return null;
  return Math.round((acc / w) * 10) / 10;
}
