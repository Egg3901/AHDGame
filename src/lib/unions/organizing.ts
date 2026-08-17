/**
 * Plain-language reading of `Union.approval`.
 *
 * Union dues v1 retired `membershipPressure` (an 0-100 organizing-intensity
 * score that was simultaneously the dues base, the unionization drift bias,
 * the strike-capacity gate, and the leadership threshold). This file used to
 * band that number under the "Organizing" label. Members are now a real
 * headcount (`unionMembers()` in `unionDues.ts`), dues are money, and the
 * number every union surface bands here is `approval`: how the membership
 * rates the bargain it is getting, 0-100, SIGNED about a neutral midpoint —
 * dues push it down, running services push it up. It is what anchors each
 * represented sector's unionization drift target, so it is also the honest
 * answer to "is this union doing well."
 *
 * Exported names are unchanged (`organizingBand`, `organizingValue`,
 * `ORGANIZING_TOOLTIP`) — every call site just passes `approval` now instead
 * of the retired `membershipPressure`.
 */

export interface OrganizingBand {
  /** One-word read on membership sentiment, shown next to the number. */
  label: string;
  /** Semantic text colour token for the band word. */
  toneClass: string;
}

/**
 * Five even 20-point bands centered on the neutral midpoint (50) that
 * `unionizationDriftTarget()` (`src/lib/labour/unionization.ts`) and
 * `approvalTarget()` (`src/lib/unions/unionDues.ts`) both treat as "neither
 * helps nor hurts": a union that charges nothing and runs nothing starts at
 * `BASE_APPROVAL` (55), inside "Content" — not disliked, merely untested.
 */
export function organizingBand(approval: number): OrganizingBand {
  const a = Number.isFinite(approval) ? approval : 0;
  if (a < 20) return { label: "Hostile", toneClass: "text-error" };
  if (a < 40) return { label: "Discontent", toneClass: "text-warning" };
  if (a < 60) return { label: "Neutral", toneClass: "text-foreground" };
  if (a < 80) return { label: "Content", toneClass: "text-success" };
  return { label: "Loyal", toneClass: "text-success" };
}

/** "62.0 / 100" — the number as every union surface prints it. */
export function organizingValue(approval: number): string {
  const a = Number.isFinite(approval) ? approval : 0;
  return `${a.toFixed(1)} / 100`;
}

/** Shared copy for the "what is this number?" tooltip. */
export const ORGANIZING_TOOLTIP =
  "How the membership feels about the bargain it is getting, scored 0-100. Dues push it down, " +
  "running services push it up. It drives how far this union's density grows or shrinks in every " +
  "sector it represents — a union that charges heavily and gives nothing back loses its own shops.";
