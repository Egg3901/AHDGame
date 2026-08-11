/**
 * Plain-language reading of `Union.membershipPressure`.
 *
 * The stored number is a 0-100 organizing-intensity score, not a headcount:
 * recruitment drives raise it (with diminishing returns near 100), it decays
 * each turn without active organizing, and it drives dues income, unionization
 * drift and strike capacity. Players read the bare number as a member count —
 * "Membership 17.0" looks like a broken stat rather than "barely organized" —
 * so every surface labels it "Organizing" and pairs it with a band word.
 */

import { LEADERSHIP_ELECTION_MIN_PRESSURE } from "./unionEconomy";

export interface OrganizingBand {
  /** One-word strength, shown next to the number. */
  label: string;
  /** Semantic text colour token for the band word. */
  toneClass: string;
}

/**
 * The first cut is the leadership-election threshold, not a round number:
 * below it a union cannot elect a president at all, so "Unorganized" doubles
 * as the reason nothing is happening yet. Bands above it split the remaining
 * range evenly.
 */
export function organizingBand(pressure: number): OrganizingBand {
  const p = Number.isFinite(pressure) ? pressure : 0;
  const step = (100 - LEADERSHIP_ELECTION_MIN_PRESSURE) / 4;
  if (p < LEADERSHIP_ELECTION_MIN_PRESSURE)
    return { label: "Unorganized", toneClass: "text-muted" };
  if (p < LEADERSHIP_ELECTION_MIN_PRESSURE + step)
    return { label: "Building", toneClass: "text-warning" };
  if (p < LEADERSHIP_ELECTION_MIN_PRESSURE + step * 2)
    return { label: "Established", toneClass: "text-foreground" };
  if (p < LEADERSHIP_ELECTION_MIN_PRESSURE + step * 3)
    return { label: "Strong", toneClass: "text-success" };
  return { label: "Dominant", toneClass: "text-success" };
}

/** "17 / 100" — the number as every union surface prints it. */
export function organizingValue(pressure: number): string {
  const p = Number.isFinite(pressure) ? pressure : 0;
  return `${p.toFixed(1)} / 100`;
}

/** Shared copy for the "what is this number?" tooltip. */
export const ORGANIZING_TOOLTIP =
  "How well organized this union is across its industry, scored 0-100. It is not a member count. " +
  "Recruitment drives push it up, and it decays slowly when nobody organizes. Higher means more dues " +
  "income, more unionized workers, and more power behind a strike.";
