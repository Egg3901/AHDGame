import type { PoliticalParty } from "@/lib/db/types";

type RegimeStatus = PoliticalParty["regimeStatus"];

interface PartyRegimeBadgeProps {
  regimeStatus: RegimeStatus | undefined;
  className?: string;
}

const STYLES: Record<
  Exclude<RegimeStatus, null | undefined>,
  { label: string; classes: string }
> = {
  ruling: {
    label: "Ruling",
    classes: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40",
  },
  approved: {
    label: "Approved",
    classes: "bg-amber-500/15 text-amber-300 border border-amber-500/40",
  },
  banned: {
    label: "Banned",
    classes: "bg-rose-500/15 text-rose-300 border border-rose-500/40",
  },
};

/**
 * Render a small inline chip that surfaces a party's regime status
 * (Ruling / Approved / Banned) in a one-party-state country.
 * Renders nothing when `regimeStatus` is null or undefined — i.e. the
 * party belongs to a non-one-party country.
 */
export function PartyRegimeBadge({ regimeStatus, className }: PartyRegimeBadgeProps) {
  if (!regimeStatus) return null;
  const style = STYLES[regimeStatus];
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        style.classes,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Regime status: ${style.label}`}
    >
      {style.label}
    </span>
  );
}
