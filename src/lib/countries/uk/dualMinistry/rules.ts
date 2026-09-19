/**
 * UK dual-ministry rules (portable core for issue #2049).
 *
 * A UK player may hold exactly one departmental portfolio plus exactly one
 * central title (Deputy Prime Minister or First Secretary of State). Two
 * departments, both central titles, and any second seat outside the UK are
 * rejected. One cabinet row per position is preserved; the shell enforces
 * this with a unique (countryId, characterId, roleSlot) index.
 *
 * Portable zone: plain data in, plain data out. No database, clock,
 * randomness, environment, network, or app imports. Time arrives as
 * YYYY-MM-DD day strings (America/New_York calendar days); the shell
 * compares them lexicographically. Callers pass the action cap in so this
 * module owns no balance constants.
 */

/** Ministerial role slot for a UK cabinet row. */
export type UkMinisterialRoleSlot = "departmental" | "central";

/**
 * UK central titles that may pair with one departmental portfolio.
 * Mirrors the seat ids in `UK_CABINET_POSITIONS`.
 */
export const UK_CENTRAL_POSITION_IDS: readonly string[] = [
  "deputy_prime_minister",
  "first_secretary_of_state",
];

/** Slot for a UK position id. Central titles return "central", all others return "departmental". */
export function roleSlotForUkPosition(positionId: string): UkMinisterialRoleSlot {
  return UK_CENTRAL_POSITION_IDS.includes(positionId) ? "central" : "departmental";
}

/**
 * Slot for a cabinet position, or null where slots do not apply.
 * Only the UK uses role slots; every other country keeps one seat per character.
 */
export function roleSlotForPosition(
  countryId: string,
  positionId: string
): UkMinisterialRoleSlot | null {
  if (countryId !== "UK") return null;
  return roleSlotForUkPosition(positionId);
}

export type DualHoldCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether a character holding `heldSlots` may take an appointment in `targetSlot`.
 * `targetSlot` is null outside the UK (single seat countries have no slots).
 */
export function canHoldAdditionalAppointment(
  countryId: string,
  heldSlots: UkMinisterialRoleSlot[],
  targetSlot: UkMinisterialRoleSlot | null
): DualHoldCheck {
  if (countryId !== "UK") {
    if (heldSlots.length > 0) {
      return { ok: false, reason: "This character already holds a cabinet position" };
    }
    return { ok: true };
  }
  if (targetSlot == null) {
    return { ok: false, reason: "Unknown cabinet position" };
  }
  if (heldSlots.length === 0) return { ok: true };
  if (heldSlots.length >= 2) {
    return { ok: false, reason: "A minister may hold at most two cabinet positions" };
  }
  if (heldSlots[0] === targetSlot) {
    return targetSlot === "central"
      ? { ok: false, reason: "A minister may not hold both central titles" }
      : { ok: false, reason: "A minister may not hold two departmental portfolios" };
  }
  return { ok: true };
}

/** One holder row feeding the shared pool computation. */
export interface SharedPoolRow {
  remaining: number;
  resetDay: string | null | undefined;
}

export interface SharedPoolState {
  remaining: number;
  resetDay: string | null;
}

/**
 * Shared pool for a UK holder across both offices: the minimum remaining
 * actions, paired with that same row's reset day, so the second title never
 * grants extra actions. Empty input resolves to a full cap pool with no reset
 * day (the shell treats a null day as stale and stamps today on write).
 */
export function sharedPoolFromRows(rows: SharedPoolRow[], cap: number): SharedPoolState {
  if (rows.length === 0) return { remaining: cap, resetDay: null };
  let best = rows[0]!;
  for (const row of rows) {
    if (row.remaining < best.remaining) best = row;
  }
  return { remaining: best.remaining, resetDay: best.resetDay ?? null };
}

/** True when the pool's reset day is not today (null or missing counts as stale). */
export function isSharedPoolStale(resetDay: string | null | undefined, today: string): boolean {
  return resetDay !== today;
}

/**
 * Position-aware candidate check: whether a character holding `heldSlots` may
 * stand for a vacancy in `vacancySlot`. A null vacancy slot (or a non-UK
 * country) keeps the legacy rule: anyone already in cabinet is excluded, so
 * position-unaware callers behave exactly as before.
 */
export function isCandidateEligibleForVacancy(
  countryId: string,
  vacancySlot: UkMinisterialRoleSlot | null,
  heldSlots: UkMinisterialRoleSlot[]
): boolean {
  if (countryId !== "UK" || vacancySlot == null) return heldSlots.length === 0;
  if (heldSlots.length >= 2) return false;
  return !heldSlots.includes(vacancySlot);
}

/** Union of policy domains across a dual holder's rows (order stable, deduplicated). */
export function unionLegislativeDomains(domainLists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of domainLists) {
    for (const domain of list) {
      if (!seen.has(domain)) {
        seen.add(domain);
        out.push(domain);
      }
    }
  }
  return out;
}
