// Shared Cold-War themed-island style tokens for the /world/conflicts pages
// (combat, generals, situation). Lives here for historical reasons; the Military
// Commands builder itself moved into the SecDef office and this route now redirects.
// Mirrors the palette + fonts used by the existing _coldwar/ boards so the
// suite reads as part of the same themed island. Not AHD design tokens by
// design — see docs/superpowers/specs/2026-07-12-military-commands-foundation-design.md.

export const MIL_FONT = {
  mono: "'IBM Plex Mono',monospace",
  serif: "Lora,Georgia,serif",
  sans: "system-ui,-apple-system,sans-serif",
} as const;

export const MIL_COLOR = {
  bg: "#0b0b11",
  panel: "#14141c",
  panelAlt: "#1d1d2a",
  inset: "#0f0f17",
  border: "#2a2a3d",
  borderSoft: "#22222e",
  text: "#e8e8ee",
  textStrong: "#f3f1ea",
  textMuted: "#9595a4",
  textFaint: "#6b6b7a",
  gold: "#d4af37",
  blue: "#3b82f6",
  red: "#dc2626",
  green: "#4ea87a",
  amber: "#cf8a4b",
} as const;

/** Command-type accent color (cw palette). */
export const TYPE_COLOR = {
  HOMELAND_DEFENSE: MIL_COLOR.blue,
  REGIONAL: "#3fb6a8",
  LOGISTICS: MIL_COLOR.gold,
} as const;

/** Effectiveness/status intent -> cw color. */
export function intentColor(intent: "success" | "warn" | "error"): string {
  return intent === "success"
    ? MIL_COLOR.green
    : intent === "warn"
      ? MIL_COLOR.gold
      : MIL_COLOR.amber;
}
