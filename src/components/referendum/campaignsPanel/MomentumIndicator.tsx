import type { ReferendumMomentum } from "@/lib/referendum/momentum";

/** Signed one-decimal string: 2.1 → "+2.1", -1.4 → "-1.4". */
function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

const ARROW: Record<ReferendumMomentum["direction"], string> = {
  up: "▲",
  down: "▼",
  flat: "—",
};

const TONE: Record<ReferendumMomentum["direction"], string> = {
  up: "text-[var(--ref-yes)]",
  down: "text-[var(--ref-no)]",
  flat: "text-muted",
};

/**
 * Compact momentum read-out: a recent-swing arrow + delta, then the since-open
 * total. Null momentum (too little history) renders the neutral inert dash.
 */
export function MomentumIndicator({ momentum }: { momentum: ReferendumMomentum | null }) {
  if (!momentum) return <span className="text-[12.5px] font-bold text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-bold">
      <span className={`inline-flex items-center gap-1 ${TONE[momentum.direction]}`}>
        <span aria-hidden>{ARROW[momentum.direction]}</span>
        {signed(momentum.recentDelta)}
      </span>
      <span className="font-semibold text-muted">· {signed(momentum.totalDelta)} since open</span>
    </span>
  );
}
