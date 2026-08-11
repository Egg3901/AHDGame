import type { SentimentPulse } from "@/lib/db/types/sentimentPulse";
import { isFtaActive, type FtaPairSet } from "@/lib/tariffs/ftaOverrides";

/** 15 minutes in milliseconds */
export const PRICE_UPDATE_INTERVAL_MS = 15 * 60 * 1_000;

/** Maximum absolute deviation from 1.0 for the sentiment multiplier. */
export const SENTIMENT_CAP = 0.25;

/** Minimum absolute impact below which a pulse is considered negligible. */
const NEGLIGIBLE_THRESHOLD = 0.001;

/** Neutral level for per-state confidence metrics (matches the registry nodes' target). */
export const HQ_CONFIDENCE_BASELINE = 60;
/** Max |deviation| from 1.0 that HQ-state investor confidence can move a share price. */
export const HQ_CONFIDENCE_SENTIMENT_CAP = 0.12;

/**
 * Share-price multiplier from the investor confidence of the corp's HQ state.
 * Heavy for the home state (a full swing from baseline moves price up to ±12%),
 * but bounded so it stacks sanely with the ±25% event-pulse `SENTIMENT_CAP`.
 * Returns 1.0 (neutral) when confidence is unknown.
 */
export function getHqConfidenceSentiment(confidence: number | null | undefined): number {
  if (confidence == null || !Number.isFinite(confidence)) return 1;
  // 0.003/pt: a full ±40-pt swing from baseline reaches the ±12% cap exactly.
  const deviation = (confidence - HQ_CONFIDENCE_BASELINE) * 0.003;
  return (
    1 + Math.max(-HQ_CONFIDENCE_SENTIMENT_CAP, Math.min(HQ_CONFIDENCE_SENTIMENT_CAP, deviation))
  );
}

/** Number of 15-minute intervals elapsed since `createdAt`. */
export function getIntervalsSince(createdAt: Date, now: Date): number {
  return Math.floor((now.getTime() - createdAt.getTime()) / PRICE_UPDATE_INTERVAL_MS);
}

/**
 * Current signed impact of a pulse at time `now`.
 * Returns 0 for pulses whose `createdAt` is in the future (edge case guard).
 */
export function getPulseImpact(pulse: SentimentPulse, now: Date): number {
  const intervals = getIntervalsSince(pulse.createdAt, now);
  if (intervals < 0) return 0;
  return pulse.initialImpact * Math.pow(pulse.decayRate, intervals);
}

/**
 * Whether this pulse affects the given corp.
 * `sectorTypes` should include both corp.type and corp.secondaryType (if present).
 *
 * `activeFtaPairs` (optional) suppresses `hqRelation === "foreign"` sector pulses
 * for corps whose HQ is bound to the pulse's issuing country by an active FTA.
 * This mirrors the runtime behaviour of `getEffectiveTariffRate`: a tariff that
 * is neutralised at customs by an FTA does not generate market sentiment against
 * the partnered exporter either. Pulses without `hqRelation === "foreign"`
 * (domestic boosts, generic subsidy/legislation pulses) are unaffected.
 */
export function pulseAppliesToCorp(
  pulse: SentimentPulse,
  corpId: string,
  headquartersCountryId: string,
  sectorTypes: string[],
  operatingSectorKeys: ReadonlySet<string> = new Set(),
  activeFtaPairs?: FtaPairSet
): boolean {
  switch (pulse.scope) {
    case "all":
      return true;
    case "country":
      return pulse.countryId === headquartersCountryId;
    case "sector": {
      if (pulse.sectorType == null) return false;
      const matchesSector = pulse.countryId
        ? operatingSectorKeys.has(`${pulse.countryId}:${pulse.sectorType}`)
        : sectorTypes.includes(pulse.sectorType);
      if (!matchesSector) return false;
      if (pulse.hqRelation === "domestic") {
        return pulse.countryId != null && headquartersCountryId === pulse.countryId;
      }
      if (pulse.hqRelation === "foreign") {
        if (pulse.countryId == null || headquartersCountryId === pulse.countryId) return false;
        if (activeFtaPairs && isFtaActive(activeFtaPairs, pulse.countryId, headquartersCountryId)) {
          return false;
        }
        return true;
      }
      return true;
    }
    case "corp":
      return pulse.corpId === corpId;
    default:
      return false;
  }
}

/**
 * Computes `sentimentMultiplier = 1 + clamp(Σ applicable impacts, −CAP, +CAP)`.
 * Negligible pulses (|impact| < 0.001) are skipped for efficiency.
 *
 * `activeFtaPairs` is forwarded to `pulseAppliesToCorp` so foreign-side tariff
 * pulses are filtered out for FTA-partnered corps.
 */
export function computeSentimentMultiplier(
  pulses: SentimentPulse[],
  now: Date,
  corpId: string,
  headquartersCountryId: string,
  sectorTypes: string[],
  operatingSectorKeys: ReadonlySet<string> = new Set(),
  activeFtaPairs?: FtaPairSet
): number {
  let totalImpact = 0;
  for (const pulse of pulses) {
    if (
      !pulseAppliesToCorp(
        pulse,
        corpId,
        headquartersCountryId,
        sectorTypes,
        operatingSectorKeys,
        activeFtaPairs
      )
    )
      continue;
    const impact = getPulseImpact(pulse, now);
    if (Math.abs(impact) < NEGLIGIBLE_THRESHOLD) continue;
    totalImpact += impact;
  }
  const clamped = Math.max(-SENTIMENT_CAP, Math.min(SENTIMENT_CAP, totalImpact));
  return 1 + clamped;
}
