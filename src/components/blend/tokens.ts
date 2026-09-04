/**
 * Design tokens for the "Blend" treatment (Proposal D of the Claude Design
 * campaign redesign canvas).
 *
 * Blend is a newsroom layout: a dark near-black ground, hairline rules instead
 * of card borders, Lora for prose and headings, JetBrains Mono for every
 * numeric and label. It deliberately does not use the app's Tailwind card
 * tokens, so the values live here rather than in `globals.css` and are pinned
 * by `tokens.test.ts`.
 *
 * Used by the campaign manager and the three presidential election screens.
 */

export const BLEND = {
  /** Page ground. */
  page: "#0c0c12",
  /** Left and right rail ground, one step above the page. */
  rail: "#101018",
  /** Inset strips (the ticker bar, branch cards). */
  inset: "#11111a",
  /** Bar and meter tracks. */
  track: "#1a1a25",
  /** The lighter track used behind delegate and support bars. */
  trackAlt: "#1d1d2a",
  /** Text input ground. */
  field: "#14141c",

  /** Standard hairline rule. */
  hairline: "#22222f",
  /** The heavier rule that separates major sections. */
  hairlineStrong: "#2a2a3d",
  /** Chip and pill borders in their resting state. */
  chipBorder: "#26263a",

  /** Primary text. */
  ink: "#e8e8ee",
  /** Secondary text: standfirsts, descriptions. */
  muted: "#8f8f9d",
  /** Tertiary text: row meta, captions. */
  mutedDim: "#6b6b7a",
  /** Quaternary text: eyebrows, axis labels. */
  mutedDimmer: "#5f5f70",

  /** The single accent family Blend uses for selection and primary actions. */
  accent: "#dc2626",
  /** Accent text on an accent-tinted ground (active rail items). */
  accentInk: "#f0a0a0",
  /** Gains, "advancing", "called". */
  positive: "#22c55e",
  /** Countdowns, "too close", maintenance warnings. */
  caution: "#eab308",
  /** President-elect and winner marks. */
  gold: "#d4af37",
  /** Losses and drags. */
  negative: "#ef4444",
} as const;

/**
 * Font stacks. Lora, JetBrains Mono and Geist are already registered in
 * `src/app/layout.tsx` via `next/font/google` and exposed as CSS variables on
 * `<body>`, so these reference the variables rather than loading anything new.
 */
export const FONT = {
  serif: "var(--font-lora), Lora, Georgia, serif",
  mono: "var(--font-jetbrains-mono), 'JetBrains Mono', ui-monospace, monospace",
  sans: "var(--font-geist-sans), Geist, system-ui, sans-serif",
} as const;

/**
 * Per-lever accent for the strategic operations board. Keys match
 * `UpgradeCategory` in `src/lib/campaigns/upgradeCosts.ts`.
 */
export const OPS_LEVER_COLOR = {
  fundraising: "#fbbf24",
  oppositionResearch: "#f87171",
  groundGame: "#60a5fa",
  mediaSpending: "#c084fc",
} as const;

/**
 * Build the segmented level bar Blend uses for operation levels: `total`
 * equal-width blocks, the first `filled` of them in `color` and the remainder
 * on the track. Returns one React style object per segment.
 *
 * `filled` is clamped into `[0, total]` so a caller passing an unclamped
 * invested count (or a negative from a partially loaded payload) still renders
 * exactly `total` segments.
 */
export function blendSegments(filled: number, total: number, color: string): React.CSSProperties[] {
  const count = Math.max(0, Math.floor(total));
  const lit = Math.max(0, Math.min(count, Math.floor(filled)));
  const out: React.CSSProperties[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      height: 8,
      flex: 1,
      borderRadius: 2,
      display: "block",
      background: i < lit ? color : BLEND.hairlineStrong,
    });
  }
  return out;
}
