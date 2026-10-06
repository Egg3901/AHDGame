import { getEconomicPositionName, positionBucketColorClass } from "@/lib/utils/politics";

export function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function getLeanLabel(lean: number): string {
  return getEconomicPositionName(lean);
}

export function getLeanColor(lean: number): string {
  return positionBucketColorClass(lean, "economic");
}

export function getLeanRowBg(lean: number): string {
  if (lean <= -2) return "bg-blue-500/5";
  if (lean < 0) return "bg-blue-500/[0.025]";
  if (lean === 0) return "";
  if (lean < 2) return "bg-red-500/[0.025]";
  return "bg-red-500/5";
}

export function appealColor(appeal: number): string {
  if (appeal >= 35) return "text-green-400";
  if (appeal >= 20) return "text-yellow-400";
  if (appeal >= 10) return "text-orange-400";
  return "text-red-400";
}

export function appealBand(appeal: number): string {
  if (appeal >= 35) return "Strong";
  if (appeal >= 20) return "Moderate";
  if (appeal >= 10) return "Weak";
  return "Very weak";
}

/** Fill class for an appeal meter, matching appealColor's bands. */
export function appealFill(appeal: number): string {
  if (appeal >= 35) return "bg-green-500";
  if (appeal >= 20) return "bg-yellow-500";
  if (appeal >= 10) return "bg-orange-500";
  return "bg-red-500";
}

const NEUTRAL_PARTY_HEX = "#9CA3AF";
const LEGACY_PARTY_HEX: Record<string, string> = { democrat: "#3b82f6", republican: "#ef4444" };

/** Display hex for a party: the stored color, else the legacy named color, else neutral gray. */
export function partyHex(
  colors: Record<string, string> | undefined,
  party: string | null | undefined
): string {
  if (!party) return NEUTRAL_PARTY_HEX;
  return colors?.[party] ?? LEGACY_PARTY_HEX[party] ?? NEUTRAL_PARTY_HEX;
}

export function partyColor(party: string): string {
  if (party === "democrat") return "text-blue-400";
  if (party === "republican") return "text-red-400";
  return "text-purple-400";
}

export function partyBadgeClass(party: string): string {
  if (party === "democrat") return "bg-blue-500/10 border-blue-500/30 text-blue-400";
  if (party === "republican") return "bg-red-500/10 border-red-500/30 text-red-400";
  return "bg-purple-500/10 border-purple-500/30 text-purple-400";
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const CATEGORY_ICONS: Record<string, string> = {
  race: "👥",
  gender: "⚧",
  education: "🎓",
  wealth: "💰",
  age: "📅",
  ideology: "🧭",
  voterGroups: "🗳️",
};
