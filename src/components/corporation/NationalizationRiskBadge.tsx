/**
 * Public "at risk of nationalization" badge with a turns-until-eligible
 * countdown. Shown to every viewer on a player corp whose financial-distress
 * grace clock is running. Fed by the corp detail route's `nationalizationRisk`.
 */
export function NationalizationRiskBadge({
  risk,
}: {
  risk?: { sinceTurn: number; turnsUntilEligible: number } | null;
}) {
  if (!risk) return null;
  const { turnsUntilEligible } = risk;
  const eligible = turnsUntilEligible <= 0;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/20 px-2.5 py-0.5 text-xs font-medium text-warning backdrop-blur-sm"
      title="A government may nationalize this corporation once it has been in financial distress past the grace window."
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      {eligible
        ? "Eligible for nationalization"
        : `At risk of nationalization — eligible in ${turnsUntilEligible} turn${
            turnsUntilEligible === 1 ? "" : "s"
          }`}
    </span>
  );
}
