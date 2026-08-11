/**
 * Shared Yes/No tug-of-war bar for the campaigns panel. `card` size is used on
 * hub cards, `hero` on the detail page. The 50% threshold marker is optional.
 */
export function TugOfWar({
  yesShare,
  yesLabel = "Yes",
  noLabel = "No",
  size = "card",
  showThreshold = false,
}: {
  yesShare: number;
  yesLabel?: string;
  noLabel?: string;
  size?: "card" | "hero";
  showThreshold?: boolean;
}) {
  const yes = Math.max(0, Math.min(100, yesShare));
  const no = 100 - Math.round(yes);
  const barH = size === "hero" ? "h-6" : "h-3";
  const numCls = size === "hero" ? "text-3xl font-black" : "text-xs font-bold";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className={`${numCls} text-[var(--ref-yes)]`}>
          {yesLabel} {Math.round(yes)}%
        </span>
        <span className={`${numCls} text-[var(--ref-no)]`}>
          {no}% {noLabel}
        </span>
      </div>
      <div
        className={`relative ${barH} w-full overflow-hidden rounded-lg bg-[color-mix(in_srgb,var(--ref-no)_14%,transparent)]`}
      >
        <div
          data-ref="yes-fill"
          className="absolute inset-y-0 left-0 bg-[var(--ref-yes)] transition-[width] duration-500"
          style={{ width: `${yes}%` }}
        />
        {showThreshold && (
          <div className="absolute inset-y-[-2px] left-1/2 w-0.5 -translate-x-1/2 bg-foreground/60" />
        )}
      </div>
    </div>
  );
}
