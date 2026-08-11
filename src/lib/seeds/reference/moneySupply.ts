import type { CountryId } from "@/lib/constants/countries";

/**
 * Broad-money calibration ratios for the unmodeled rest of the economy.
 * These are deliberately ratios, not claims that player balances reproduce a
 * national statistical series. The 1953 table gives historical worlds their
 * own monetary scale while the snapshot keeps modeled balances fully visible.
 */
const M2_TO_GDP_1953: Partial<Record<CountryId, number>> = {
  US: 0.62,
  UK: 0.58,
  JP: 0.45,
  DE: 0.38,
  IE: 0.5,
  BR: 0.28,
  CN: 0.32,
  RU: 0.42,
  DD: 0.4,
  FR: 0.52,
  IT: 0.42,
  ES: 0.4,
  SE: 0.62,
  TR: 0.3,
  NG: 0.25,
};

export function broadMoneyToGdpRatio(preset: string, countryId: CountryId): number {
  if (preset === "1953-default") return M2_TO_GDP_1953[countryId] ?? 0.4;
  if (preset === "1979-default") return 0.55;
  if (preset === "1991-default") return 0.65;
  return 0.8;
}
