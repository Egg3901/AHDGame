export type RarityTier = "common" | "uncommon" | "rare" | "epic" | "legendary";

interface RarityStyle {
  tier: RarityTier;
  label: string;
  borderColor: string;
  glowClass: string;
}

const TIERS: { max: number; style: RarityStyle }[] = [
  {
    max: 1,
    style: {
      tier: "legendary",
      label: "Legendary",
      borderColor: "#F59E0B",
      glowClass: "shadow-[0_0_8px_rgba(245,158,11,0.4)]",
    },
  },
  {
    max: 5,
    style: {
      tier: "epic",
      label: "Epic",
      borderColor: "#A855F7",
      glowClass: "shadow-[0_0_8px_rgba(168,85,247,0.35)]",
    },
  },
  { max: 10, style: { tier: "rare", label: "Rare", borderColor: "#3B82F6", glowClass: "" } },
  {
    max: 25,
    style: { tier: "uncommon", label: "Uncommon", borderColor: "#22C55E", glowClass: "" },
  },
  {
    max: Infinity,
    style: { tier: "common", label: "Common", borderColor: "#6B7280", glowClass: "" },
  },
];

export function getRarityStyle(rarityPct: number): RarityStyle {
  for (const { max, style } of TIERS) {
    if (rarityPct < max) return style;
  }
  return TIERS[TIERS.length - 1].style;
}
