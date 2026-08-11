/**
 * Participation quality in a state where the vote has no alternative.
 *
 * THE PROBLEM THIS FIXES. `governance.participation` is derived (tier 1) from
 * legacy `governance.voterTurnout`, and turnout ALONE cannot tell a mobilised
 * electorate from a compelled one. Measured on the emitted 1953 boards, most of
 * the countries that pinned participation at exactly 100 were one-party states
 * (BAL, BG, BLR, CN, CS, HU, PL, RO, UKR, YU) running
 * single-slate elections at ~99% turnout. The model was saying Rákosi's Hungary
 * had the best political participation in the world.
 *
 * WHY IT COULD NOT BE FIXED BY MOVING THE BAND. Raising the era band's `best`
 * to ~99 makes it worse, not better: the sham states climb to the top of the
 * scale and the genuine high-turnout democracies (AT, IT, SE at 86-95%) fall
 * below them. The band describes what turnout was ACHIEVABLE in an era; it
 * cannot describe whether achieving it meant anything.
 *
 * WHY IT IS NOT SOMEONE ELSE'S FAMILY. The board has seven governance
 * families — administration, centralAuthority, decisiveness, integrity,
 * localAutonomy, openness, participation — and none of them is about electoral
 * competitiveness. So there is nowhere else for "the ballot had one name on it"
 * to show up, and leaving participation at 100 leaves it unsaid entirely.
 *
 * THE MODEL. A one-party state genuinely mobilises people to the polls, so the
 * floor is not zero — voting happens, at scale, and is a real part of how the
 * regime governs. What is missing is CHOICE. So turnout still orders these
 * countries among themselves, but over a compressed range that tops out below
 * the free-election scale: near-universal compelled turnout reads as middling
 * participation, not ideal participation.
 *
 * This is a calibration knob, deliberately a single number rather than a curve.
 */
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/**
 * The most `governance.participation` a single-slate election can score.
 *
 * Set just above the midpoint: mass compelled turnout is a real phenomenon and
 * should not read as civic collapse, but it must sit clearly below what a
 * competitive election with comparable turnout earns. At this ceiling Hungary's
 * ~99% lands near 55 while Austria's genuine 95% keeps its 100.
 */
export const ONE_PARTY_PARTICIPATION_CEILING = 55;

/**
 * True when the country's elections offer no alternative, so turnout measures
 * compliance rather than choice.
 *
 * Reads `governmentType` from the country config rather than a list local to
 * this file. The bloc countries only seed in Cold-War-era presets, so the
 * config's answer is the era's answer; a hand-kept second list here would drift
 * from the one the rest of the game already uses for confidence votes and
 * cabinet mechanics.
 */
export function hasSingleSlateElections(countryId: string): boolean {
  return COUNTRY_CONFIGS[countryId as CountryId]?.governmentType === "onePartyState";
}

/**
 * Compress a participation score into the single-slate range.
 *
 * Proportional rather than a hard clamp, so turnout still DIFFERENTIATES these
 * countries: a bloc state with 99% turnout still scores above one with 85%.
 * A clamp would flatten all nine to the same number and trade one kind of
 * saturation for another.
 *
 * Returns `score` unchanged for every competitive-election country, so this is
 * parity-preserving everywhere it does not apply.
 */
export function regimeAdjustedParticipation(score: number, countryId: string): number {
  if (!Number.isFinite(score)) return score;
  if (!hasSingleSlateElections(countryId)) return score;
  return (score / 100) * ONE_PARTY_PARTICIPATION_CEILING;
}
