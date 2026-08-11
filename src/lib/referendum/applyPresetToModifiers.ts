import type { ReferendumCohort, CohortModifier } from "@/lib/referendum/cohortEngine";
import type { GroundGamePreset } from "@/lib/constants/groundGamePresets";
import {
  GG_PERSUADE_TARGET_CONC,
  GG_MOBILIZE_TARGET_CONC,
  GG_MOBILIZE_LEAN_FRACTION,
} from "@/lib/constants/referendum";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Accumulate a preset's effect onto the cohort modifiers as RAW signed units
 * (the soft cap is applied at read time in `aggregateYesShare`). Whole-electorate
 * persuade adds a uniform per-cohort lean == `leanSwing`, so the aggregate moves
 * by exactly `leanSwing`; targeting concentrates onto one cohort (its aggregate
 * effect is naturally bounded by the cohort's share). Mobilize raises a cohort's
 * turnout scaled by how aligned it is to the spender's side, plus a small
 * same-side lean nudge — so GOTV turns out *your* base and `side` matters.
 * 0-share cohorts are skipped. Pure — returns a new modifier array.
 */
export function applyPresetToModifiers(
  baseline: ReferendumCohort[],
  mods: CohortModifier[],
  preset: GroundGamePreset,
  side: "yes" | "no",
  target: "whole" | { groupId: string }
): CohortModifier[] {
  const next = mods.map((m) => ({ ...m }));
  const dir = side === "yes" ? 1 : -1;
  const bump = (c: ReferendumCohort, conc: number) => {
    let m = next.find((x) => x.groupId === c.groupId);
    if (!m) {
      m = { groupId: c.groupId, turnoutMod: 0, leanMod: 0 };
      next.push(m);
    }
    if (preset.effect === "persuade") {
      m.leanMod += dir * (preset.leanSwing ?? 0) * conc;
    } else {
      const align = clamp(((side === "yes" ? c.yesLean : 100 - c.yesLean) - 50) / 50, 0, 1);
      const push = preset.turnoutPush ?? 0;
      m.turnoutMod += push * conc * align;
      m.leanMod += dir * push * conc * GG_MOBILIZE_LEAN_FRACTION;
    }
  };
  if (target === "whole") {
    for (const c of baseline) if (c.share > 0) bump(c, 1);
  } else {
    const c = baseline.find((x) => x.groupId === target.groupId);
    if (c)
      bump(c, preset.effect === "persuade" ? GG_PERSUADE_TARGET_CONC : GG_MOBILIZE_TARGET_CONC);
  }
  return next;
}
