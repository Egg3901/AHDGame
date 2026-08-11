export type PatreonTier = "supporter" | "supporter-plus" | "supporter-plus-plus" | null;

/**
 * True when the tier is Supporter+ or higher (Supporter++). Use for gates that
 * mean "plus-level benefits or better" rather than an exact tier match.
 */
export function isPlusOrBetter(tier: PatreonTier): boolean {
  return tier === "supporter-plus" || tier === "supporter-plus-plus";
}

/**
 * Which system granted a user's current supporter benefits.
 * - "patreon": pledged via Patreon (default, legacy behaviour).
 * - "stripe": subscribed via the Lakeside account portal (Stripe).
 * - "bot": granted manually by the Discord bot / staff.
 * Used to keep the Patreon reconciler from grace-out'ing Stripe subscribers,
 * who never appear in Patreon's member list.
 */
export type SupporterProvider = "patreon" | "stripe" | "bot" | null;

export type ProfileBorderKey =
  | "default-tint"
  | "soft-glow"
  | "double-ring"
  | "etched-band"
  | "comet"
  | "signal-beacon"
  | "aurora"
  | "prism"
  | "ember-crown"
  | "ion-storm"
  | "starlight"
  | "pulse"
  | "spotlight"
  | "picture-frame"
  | "gallery-frame"
  | "silver-frame"
  | "obsidian-frame"
  | "gold-gradient"
  | "silver-etched"
  | "platinum-shine"
  | "crimson-gold"
  | "midnight-purple"
  | "emerald-wave"
  | "cosmic-nebula"
  | "party-sync";

export interface PatreonBorderOption {
  key: ProfileBorderKey;
  label: string;
  group: "default" | "static" | "animated" | "frame" | "legacy";
  tintable: boolean;
}

export const PATREON_BORDER_OPTIONS: PatreonBorderOption[] = [
  { key: "default-tint", label: "Default Tint", group: "default", tintable: true },
  { key: "soft-glow", label: "Soft Glow", group: "static", tintable: true },
  { key: "double-ring", label: "Double Ring", group: "static", tintable: true },
  { key: "etched-band", label: "Etched Band", group: "static", tintable: true },
  { key: "comet", label: "Comet Ring", group: "animated", tintable: true },
  { key: "signal-beacon", label: "Signal Beacon", group: "animated", tintable: true },
  { key: "aurora", label: "Aurora Ribbon", group: "animated", tintable: true },
  { key: "prism", label: "Prism", group: "animated", tintable: false },
  { key: "ember-crown", label: "Ember Crown", group: "animated", tintable: false },
  { key: "ion-storm", label: "Ion Storm", group: "animated", tintable: false },
  { key: "starlight", label: "Starlight Orbit", group: "animated", tintable: false },
  { key: "picture-frame", label: "Picture Frame", group: "frame", tintable: false },
  { key: "gallery-frame", label: "Gallery Frame", group: "frame", tintable: false },
  { key: "silver-frame", label: "Silver Frame", group: "frame", tintable: false },
  { key: "obsidian-frame", label: "Obsidian Frame", group: "frame", tintable: false },
  { key: "gold-gradient", label: "Gold Gradient", group: "legacy", tintable: false },
  { key: "silver-etched", label: "Silver Etched", group: "legacy", tintable: false },
  { key: "platinum-shine", label: "Platinum Shine", group: "legacy", tintable: false },
  { key: "crimson-gold", label: "Crimson Gold", group: "legacy", tintable: false },
  { key: "midnight-purple", label: "Midnight Purple", group: "legacy", tintable: false },
  { key: "emerald-wave", label: "Emerald Wave", group: "legacy", tintable: false },
  { key: "cosmic-nebula", label: "Cosmic Nebula", group: "legacy", tintable: false },
  { key: "party-sync", label: "Party Sync", group: "legacy", tintable: false },
] as const;

export const PATREON_HIGHLIGHT_COLORS = {
  default: "#d4a24c",
} as const;

export type PatreonHighlightColorKey = keyof typeof PATREON_HIGHLIGHT_COLORS;

export const PATREON_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export function isPatreonActive(tier: PatreonTier, expiresAt?: Date | null): boolean {
  if (tier === null) return false;
  if (expiresAt == null) return true;
  return expiresAt.getTime() > Date.now();
}
