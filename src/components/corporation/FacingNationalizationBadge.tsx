/**
 * Public "facing nationalization" hero chip. Fires when a corporation is the
 * target of a legislative nationalization — a pending taking (notice window) or
 * a bill still in voting — against the whole corp and/or some of its sectors.
 * Fed by the corp detail route's `nationalizationThreat`. Red/error tone, more
 * imminent than the amber distress-grace chip.
 */
export function FacingNationalizationBadge({
  threat,
}: {
  threat?: {
    whole: boolean;
    sectorCount: number;
    stage: "voting" | "pending" | "both";
    soonestTakingDeadlineTurn: number | null;
    turnsUntilTaking: number | null;
  } | null;
}) {
  if (!threat || (!threat.whole && threat.sectorCount === 0)) return null;

  const sectors =
    threat.sectorCount > 0
      ? `${threat.sectorCount} sector${threat.sectorCount === 1 ? "" : "s"}`
      : "";
  const scope =
    threat.whole && sectors ? `whole corp + ${sectors}` : threat.whole ? "whole corp" : sectors;

  const hint =
    threat.turnsUntilTaking != null
      ? threat.turnsUntilTaking <= 0
        ? "taking imminent"
        : `taking in ${threat.turnsUntilTaking} turn${threat.turnsUntilTaking === 1 ? "" : "s"}`
      : "in voting";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-error/40 bg-error/20 px-2.5 py-0.5 text-xs font-medium text-error backdrop-blur-sm"
      title="This corporation is the target of a legislative nationalization (a passed taking in its notice window, or a bill still in voting)."
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      </svg>
      Facing nationalization — {scope} · {hint}
    </span>
  );
}
