import type { ActiveModifier } from "@/lib/utils/approvalModifiers";

/**
 * Rules for two national approval drags that scale with the government's
 * circumstances instead of sitting at a fixed value: public expectations (a
 * honeymoon ramp) and the empty cabinet seats penalty (a sliding scale).
 * Plain data in, plain data out; the turn snapshot owns every read and write.
 */

/** Full-strength public expectations drag, in approval points. */
export const PUBLIC_EXPECTATIONS_FULL_EFFECT = -5;

/**
 * Turns in office for the expectations drag to reach full strength. Turns are
 * hourly, so 48 is two real days: long enough that a new leader feels a
 * honeymoon, short enough that nobody coasts on one.
 */
export const EXPECTATIONS_RAMP_TURNS = 48;

/** Approval penalty for a country with no cabinet seat filled. */
export const NO_CABINET_PENALTY = 7.5;

/**
 * The public expectations modifier for a head of government who took office on
 * `sinceTurn`. Zero on that turn, linear to the full drag over
 * {@link EXPECTATIONS_RAMP_TURNS}, flat after. An unknown start (`null` or
 * `undefined`, or a start in the future) keeps the full drag, the behaviour
 * before the ramp existed.
 */
export function publicExpectationsModifier(
  sinceTurn: number | null | undefined,
  currentTurn: number
): ActiveModifier {
  const base = { id: "public_expectations", marginEffect: 0, source: "metric" as const };
  const full: ActiveModifier = {
    ...base,
    label: "Higher public expectations",
    effect: PUBLIC_EXPECTATIONS_FULL_EFFECT,
  };
  if (typeof sinceTurn !== "number" || !Number.isFinite(sinceTurn) || sinceTurn > currentTurn) {
    return full;
  }
  const turnsInOffice = Math.floor(currentTurn - sinceTurn);
  if (turnsInOffice >= EXPECTATIONS_RAMP_TURNS) return full;
  const effect =
    -Math.round(-PUBLIC_EXPECTATIONS_FULL_EFFECT * (turnsInOffice / EXPECTATIONS_RAMP_TURNS) * 10) /
    10;
  return {
    ...base,
    label: `Higher public expectations (building up, ${turnsInOffice} ${
      turnsInOffice === 1 ? "turn" : "turns"
    } in office)`,
    // `+ 0` folds -0 into 0 on the turn the leader took office.
    effect: effect + 0,
  };
}

/** What the snapshot stores about who leads the government and since when. */
export interface HeadTenure {
  /** Identity of the head of government; `null` while the seat is vacant. */
  key: string | null;
  /** Turn the current head took office; `null` when unknown. */
  sinceTurn: number | null;
}

/**
 * Advance the stored tenure by one observation of the current head.
 *
 * `prev` is `undefined` before the first observation. The head is then recorded
 * with `seedSinceTurn`, the turn the records say they took office (formation turn
 * or election date), so a leader already partway into a term gets the honeymoon
 * they are owed rather than a fresh one or none. No usable seed means an unknown
 * start (full drag). Any later change of head, including a new head after a
 * vacancy, starts the clock at `turn`.
 */
export function advanceHeadTenure(
  prev: HeadTenure | undefined,
  currentKey: string | null,
  turn: number,
  seedSinceTurn: number | null = null
): HeadTenure {
  if (currentKey === null) return { key: null, sinceTurn: null };
  if (prev === undefined) {
    const seeded =
      typeof seedSinceTurn === "number" && Number.isFinite(seedSinceTurn)
        ? Math.min(Math.max(0, Math.floor(seedSinceTurn)), turn)
        : null;
    return { key: currentKey, sinceTurn: seeded };
  }
  if (prev.key === currentKey) return { key: currentKey, sinceTurn: prev.sinceTurn };
  return { key: currentKey, sinceTurn: turn };
}

/**
 * The empty-seat penalty: {@link NO_CABINET_PENALTY} scaled by the share of
 * seats left empty. `null` when nothing is owed. An acting secretary holds a
 * seat, so it never counts as empty here (the acting penalty is separate).
 *
 * `totalSeats` is the number of appointable seats and `seatedCount` how many of
 * them are held. With an unknown total (`undefined`, or not a positive integer)
 * the penalty is the old binary one: full only when nobody at all is seated.
 */
export function emptyCabinetSeatsModifier(
  seatedCount: number,
  totalSeats: number | undefined
): ActiveModifier | null {
  const knownTotal =
    typeof totalSeats === "number" && Number.isInteger(totalSeats) && totalSeats > 0;
  if (!knownTotal) {
    if (seatedCount > 0) return null;
    return {
      id: "cabinet_none",
      label: "No cabinet seated",
      effect: -NO_CABINET_PENALTY,
      // Explicit, like the war block's. Readers that see no marginEffect derive one
      // from the modifier id, and a cabinet vacancy is not a profit-margin event.
      marginEffect: 0,
    };
  }
  const empty = Math.max(0, totalSeats - Math.min(seatedCount, totalSeats));
  if (empty === 0) return null;
  if (empty === totalSeats) {
    return {
      id: "cabinet_none",
      label: "No cabinet seated",
      effect: -NO_CABINET_PENALTY,
      marginEffect: 0,
    };
  }
  return {
    id: "cabinet_none",
    label: `Empty cabinet seats (${empty} of ${totalSeats})`,
    // Magnitude rounded, so half-tenths round away from zero on the penalty.
    effect: -Math.round(NO_CABINET_PENALTY * (empty / totalSeats) * 10) / 10,
    marginEffect: 0,
  };
}

/**
 * The turn a dated event happened on, counting back from `currentTurn` at
 * `msPerTurn` wall-clock ms per turn. `null` for a missing or future date.
 */
export function turnForDate(
  date: Date | null | undefined,
  currentTurn: number,
  now: Date,
  msPerTurn: number
): number | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < 0) return null;
  return Math.max(0, currentTurn - Math.floor(elapsed / msPerTurn));
}
