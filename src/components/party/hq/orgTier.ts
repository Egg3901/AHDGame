export type Tone = "good" | "mid" | "warn" | "bad";

export interface Tier {
  label: string;
  tone: Tone;
}

/** Organization% → tier label + tone. */
export function orgTier(pct: number): Tier {
  if (pct >= 85) return { label: "Dominant", tone: "good" };
  if (pct >= 62) return { label: "Strong", tone: "good" };
  if (pct >= 45) return { label: "Competitive", tone: "mid" };
  if (pct >= 28) return { label: "Developing", tone: "warn" };
  return { label: "Minimal", tone: "bad" };
}

const TONE_COLORS: Record<Tone, string> = {
  good: "var(--success, rgb(34,197,94))",
  mid: "var(--info, rgb(59,130,246))",
  warn: "var(--warning, rgb(245,158,11))",
  bad: "var(--error, rgb(239,68,68))",
};

export function toneColor(tone: Tone): string {
  return TONE_COLORS[tone];
}

/**
 * Choropleth fill for a 0–100 value — a single accent hue whose lightness/alpha
 * scales with the value, so dense regions read darker/stronger. Used for both
 * Org% and Reg% map coloring.
 */
export function orgFill(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  // 0% → faint, 100% → solid accent green.
  const alpha = 0.12 + (clamped / 100) * 0.78;
  return `rgba(34, 197, 94, ${alpha.toFixed(3)})`;
}

export interface LeanLabel {
  label: string;
  color: string;
}

/** Region partisan lean value (−5..+5 scale) → short label + color. */
export function leanLabelFromValue(v: number): LeanLabel {
  const a = Math.abs(v);
  if (a < 0.5) return { label: "Even", color: "var(--muted, #a1a1aa)" };
  const strength = a >= 3 ? "Strong" : a >= 1.5 ? "Lean" : "Tilt";
  // Positive = right-leaning (US convention), negative = left-leaning.
  const side = v > 0 ? "R" : "D";
  const color = v > 0 ? "rgb(239,68,68)" : "rgb(59,130,246)";
  return { label: `${strength} ${side}`, color };
}
