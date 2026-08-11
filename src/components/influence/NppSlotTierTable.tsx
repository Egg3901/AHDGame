import { RECRUITMENT_SLOT_TIERS } from "@/lib/npp/recruitment";

interface NppSlotTierTableProps {
  /** Current state organization (percent) used to highlight the active tier. */
  currentOrg?: number;
  className?: string;
}

/** Human-readable org range for a tier given its position in the ascending list. */
function tierRangeLabel(index: number): string {
  const tier = RECRUITMENT_SLOT_TIERS[index];
  const next = RECRUITMENT_SLOT_TIERS[index + 1];
  if (index === 0 && tier.minOrg === 0) return `under ${next?.minOrg ?? 0}%`;
  if (next) return `${tier.minOrg}% – ${next.minOrg - 1}%`;
  return `${tier.minOrg}%+`;
}

/** Index of the highest tier the given org qualifies for (matches calculateRecruitmentSlots). */
function activeTierIndex(org: number): number {
  let active = 0;
  RECRUITMENT_SLOT_TIERS.forEach((tier, i) => {
    if (org >= tier.minOrg) active = i;
  });
  return active;
}

/**
 * Reference table of per-state NPP recruitment slot caps by state organization.
 * Reads tiers from the single source of truth (RECRUITMENT_SLOT_TIERS) and, when
 * a currentOrg is provided, highlights the tier that org currently qualifies for.
 */
export function NppSlotTierTable({ currentOrg, className = "" }: NppSlotTierTableProps) {
  const hasOrg = typeof currentOrg === "number";
  const activeIndex = hasOrg ? activeTierIndex(currentOrg) : -1;
  const lastIndex = RECRUITMENT_SLOT_TIERS.length - 1;

  return (
    <div className={`rounded-lg border border-card-border bg-card-elevated p-3 ${className}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
          Slots by state org
        </span>
        {hasOrg && <span className="text-[10px] text-muted">current {currentOrg.toFixed(0)}%</span>}
      </div>
      <div className="space-y-0.5">
        {RECRUITMENT_SLOT_TIERS.map((tier, i) => {
          const active = i === activeIndex;
          return (
            <div
              key={tier.minOrg}
              className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
                active ? "bg-primary/10 text-primary" : "text-muted"
              }`}
            >
              <span className={active ? "font-semibold" : ""}>{tierRangeLabel(i)}</span>
              <span className={active ? "font-semibold" : "text-foreground"}>
                {tier.slots} slot{tier.slots !== 1 ? "s" : ""}
                {i === lastIndex && <span className="ml-1 text-muted">(max)</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
