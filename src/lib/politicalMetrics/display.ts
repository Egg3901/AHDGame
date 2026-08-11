import type { PoliticalLean } from "./types";

/** Lean describes political ASSOCIATION, never quality (spec §2.2). */
export const LEAN_LABELS: Record<PoliticalLean, string> = {
  [-5]: "Strong Left",
  [-3]: "Left",
  [-1]: "Center-Left",
  [0]: "Mixed",
  [1]: "Center-Right",
  [3]: "Right",
  [5]: "Strong Right",
};

export function leanLabelFor(lean: PoliticalLean): string {
  return LEAN_LABELS[lean];
}

/** Performance bands (0–100 objective score), highest threshold first. */
export const STATUS_BANDS = [
  { min: 85, label: "Exceptional" },
  { min: 70, label: "Strong" },
  { min: 55, label: "Stable" },
  { min: 40, label: "Strained" },
  { min: 25, label: "Weak" },
  { min: 0, label: "Critical" },
] as const;

export function statusFor(score: number): string {
  return (STATUS_BANDS.find((b) => score >= b.min) ?? STATUS_BANDS[STATUS_BANDS.length - 1]).label;
}
