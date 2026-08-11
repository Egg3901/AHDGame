/**
 * Shared approval→coattail magnitude math, used by both the governor
 * coattail (`govCoattail.ts`) and the presidential coattail
 * (`presidentialCoattail.ts`). A sitting executive at the neutral approval
 * baseline is 1.0×; above it lifts (up to +COATTAIL_MAX_BONUS at
 * +COATTAIL_APPROVAL_SATURATION points), below it drags (down to
 * 1 − COATTAIL_MAX_BONUS).
 */

import { COATTAIL_MAX_BONUS, COATTAIL_APPROVAL_SATURATION } from "./constants";
import { BASE_APPROVAL } from "@/lib/utils/governmentApproval";

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Nominal-share multiplier for an executive at the given approval (0–100):
 * `1 + clamp((approval − BASE_APPROVAL) / COATTAIL_APPROVAL_SATURATION, −1, 1)
 * × COATTAIL_MAX_BONUS`.
 */
export function approvalCoattailMultiplier(approval: number): number {
  const swing = clamp((approval - BASE_APPROVAL) / COATTAIL_APPROVAL_SATURATION, -1, 1);
  return 1 + swing * COATTAIL_MAX_BONUS;
}

/**
 * Convert a coattail multiplier map into signed percentage tilts for display
 * (e.g. 1.045 → +4.5). Pure; used by the persuasion-drivers card.
 */
export function coattailMultiplierMapToPct(modifier: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [party, mult] of modifier) {
    out[party] = (mult - 1) * 100;
  }
  return out;
}
