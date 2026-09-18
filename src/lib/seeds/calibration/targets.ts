import type { EraId } from "@/lib/seeds/presetSelector";
import type { CalibrationTarget, CountryId } from "./types";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { US_GEOGRAPHY } from "@/lib/countries/us/geography";
import { UK_GEOGRAPHY } from "@/lib/countries/uk/geography";
import { DE_GEOGRAPHY } from "@/lib/countries/de/geography";
import { IE_GEOGRAPHY } from "@/lib/countries/ie/geography";
import { RU_GEOGRAPHY } from "@/lib/countries/ru/geography";
import { DD_GEOGRAPHY } from "@/lib/countries/dd/geography";
import { BR_GEOGRAPHY } from "@/lib/countries/br/geography";

/**
 * Election-anchored targets. center/spread on the derived −5..+5 scale; sign
 * anchors and orderings come from real results (nearest election to the era).
 * Tolerances start loose-ish and tighten as calibration converges.
 *
 * Region IDs:
 *   US: USPS state codes + DC.
 *   UK: LON SEE SWE EAE EMI WMI YHU NWE NEE SCO WAL NIR (NIR omitted from L/R
 *       anchors — its cleavage is unionist/nationalist, not left/right).
 *   DE: BW BY NW HE RP SL NI SH HH BRE BE BB MV SN ST TH.
 *   JP: HOK TOH KAN CHU KNS CGK SHI KYU.
 *   IE: DUB KIL MID WEX LIM COR GAL DON.
 *   BR: NORTE NORDESTE CENTRO_OESTE SUDESTE SUL.
 *
 * Confidence is noted in `election`. Low-confidence cells use center+spread only
 * (few/no sign anchors) and are the priority for Egg's review.
 */
export const TARGETS: Partial<Record<CountryId, Partial<Record<EraId, CalibrationTarget>>>> = {
  // ─── United States — presidential, by state ───────────────────────────────
  US: US_GEOGRAPHY.calibrationTargets,

  // ─── The four countries enabled in the 1953 iteration ─────────────────────
  // US/UK/RU/DD are what players can actually pick. RU and DD had no cell at
  // all, and their regions were politically indistinguishable (economic spread
  // 0.30 and 0.10 across the whole country), which made the home-region choice
  // meaningless for half the playable roster.
  RU: RU_GEOGRAPHY.calibrationTargets,

  DD: DD_GEOGRAPHY.calibrationTargets,

  // ─── United Kingdom — House of Commons vote share, by region ───────────────
  UK: UK_GEOGRAPHY.calibrationTargets,

  // ─── Germany — Bundestag vote share, by Land ──────────────────────────────
  // Pre-1990 eras: eastern Länder may be absent/placeholder in census — anchors
  // restricted to western Länder for 1979/1991. Flag for review.
  DE: DE_GEOGRAPHY.calibrationTargets,

  // ─── Japan — House of Representatives, by region (urban left / rural LDP) ──
  // Japan's regional left-right is subtle (LDP rural-dominant). Anchors are the
  // clearest urban (left) vs rural (right) contrast only. Low confidence.
  JP: JP_GEOGRAPHY.calibrationTargets,

  // ─── Ireland — Dáil, by region ────────────────────────────────────────────
  // Irish politics is weakly left-right (FF/FG both centre-right historically).
  // Center+spread only, with Dublin (urban left) the single robust anchor.
  // LOW CONFIDENCE across the board — primary review target.
  IE: IE_GEOGRAPHY.calibrationTargets,

  // ─── Brazil — presidential, by macro-region (1979 excluded) ───────────────
  // The Nordeste(left)/Sul(right) cleavage is a post-2002 (Lula) phenomenon;
  // earlier eras anchor center+spread only. Modern eras anchor signs.
  BR: BR_GEOGRAPHY.calibrationTargets,
};

export function getTarget(country: string, era: EraId): CalibrationTarget | undefined {
  return TARGETS[country as CountryId]?.[era];
}
