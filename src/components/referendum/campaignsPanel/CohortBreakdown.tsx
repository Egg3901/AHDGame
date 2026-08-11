import Link from "next/link";

export interface CohortRow {
  groupId: string;
  name: string;
  share: number; // 0..1
  turnout: number; // 0..100 (effective)
  yesLean: number; // 0..100 (effective)
}

function CohortBar({
  name,
  share,
  lean,
  yesLabel,
  href,
  active,
}: {
  name: string;
  share: number | null;
  lean: number;
  yesLabel: string;
  href?: string;
  active?: boolean;
}) {
  const cls = `block rounded-xl border px-4 py-3 transition-colors ${
    active ? "border-primary ring-1 ring-primary/40" : "border-card-border"
  } ${href ? "hover:border-primary/50" : ""}`;
  const inner = (
    <>
      <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
        <span className="font-semibold">{name}</span>
        <span className="font-mono text-muted">
          {share != null ? `${Math.round(share * 100)}% · ` : ""}
          <span className="font-bold text-[var(--ref-yes)]">{Math.round(lean)}%</span> {yesLabel}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ref-no)_18%,transparent)]">
        <div
          className="h-full rounded-full bg-[var(--ref-yes)]"
          style={{ width: `${Math.max(0, Math.min(100, lean))}%` }}
        />
      </div>
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** Horizontal "Where the votes are" lean bars: a whole-electorate summary row
 *  plus a per-cohort Yes-lean bar (share + lean labelled). Display-only — the
 *  tap-to-target interaction is wired by the ground-game sub-project. */
export function CohortBreakdown({
  rows,
  labels = { yes: "Yes", no: "No" },
  yesShare,
  targetHref,
  activeTarget,
}: {
  rows: CohortRow[];
  labels?: { yes: string; no: string };
  yesShare?: number;
  /** When provided, each bar links to `targetHref(groupId | "whole")` (tap to target). */
  targetHref?: (target: string) => string;
  activeTarget?: string;
}) {
  return (
    <div className="rounded-2xl border border-card-border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
          Where the votes are
        </h2>
        <span className="text-[11px] text-muted">tap a group to target your spend</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-[12.5px] font-bold text-muted">No cohort data for this region.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {yesShare != null && (
            <CohortBar
              name="Whole electorate"
              share={1}
              lean={yesShare}
              yesLabel={labels.yes}
              href={targetHref?.("whole")}
              active={activeTarget == null || activeTarget === "whole"}
            />
          )}
          {rows.map((r) => (
            <CohortBar
              key={r.groupId}
              name={r.name}
              share={r.share}
              lean={r.yesLean}
              yesLabel={labels.yes}
              href={targetHref?.(r.groupId)}
              active={activeTarget === r.groupId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
