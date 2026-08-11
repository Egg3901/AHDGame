"use client";

export type BillVoteFilter = "all" | "voted" | "not_voted";
export type BillStatusFilterOption = { value: string; label: string };

interface BillListControlsProps {
  voteFilter: BillVoteFilter;
  onVoteFilterChange: (filter: BillVoteFilter) => void;
  showVoteFilter: boolean;
  statusFilter?: string;
  statusFilterOptions?: BillStatusFilterOption[];
  onStatusFilterChange?: (filter: string) => void;
}

const VOTE_FILTERS: { value: BillVoteFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "voted", label: "Voted" },
  { value: "not_voted", label: "Not Voted" },
];

export function BillListControls({
  voteFilter,
  onVoteFilterChange,
  showVoteFilter,
  statusFilter,
  statusFilterOptions,
  onStatusFilterChange,
}: BillListControlsProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {statusFilterOptions?.length && statusFilter && onStatusFilterChange ? (
          <div className="flex items-center rounded-lg border border-card-border bg-card p-0.5">
            {statusFilterOptions.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => onStatusFilterChange(filter.value)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
                  statusFilter === filter.value
                    ? "bg-primary/20 text-primary"
                    : "bg-card text-muted hover:text-foreground"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        ) : null}

        {showVoteFilter ? (
          <div className="flex items-center rounded-lg border border-card-border bg-card p-0.5">
            {VOTE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => onVoteFilterChange(f.value)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
                  voteFilter === f.value
                    ? "bg-primary/20 text-primary"
                    : "bg-card text-muted hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}
