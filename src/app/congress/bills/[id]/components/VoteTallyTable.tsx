import type { VoteByParty } from "../types";

const numericHeadClass = "text-right py-2 px-2 font-medium tabular-nums whitespace-nowrap";
const numericCellClass = "text-right py-1.5 px-2 tabular-nums whitespace-nowrap";

export function VoteTallyTable({
  voteByParty,
  chamberLabel,
  forLabel = "For",
  againstLabel = "Against",
}: {
  voteByParty: VoteByParty[];
  chamberLabel: string;
  /** Column header for the "for" column (e.g. Aye for parliamentary confidence votes). */
  forLabel?: string;
  /** Column header for the "against" column (e.g. Nay). */
  againstLabel?: string;
}) {
  if (!voteByParty.length) return null;
  return (
    <>
      {/* Mobile: stacked rows. Long party names used to widen the table past the
          viewport; html/body clip horizontal overflow, so Against/Abstain/Total
          were unreachable and overflow-x-auto never became a scrollport. */}
      <div className="space-y-3 sm:hidden">
        {voteByParty.map((p) => (
          <div
            key={p.party}
            className="min-w-0 border-b border-card-border/50 pb-3 last:border-0 last:pb-0"
          >
            <div className="flex min-w-0 items-start gap-1.5 font-medium">
              <span
                className="mt-1 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: p.partyColor }}
              />
              <span className="min-w-0 break-words">{p.partyName}</span>
            </div>
            <dl className="mt-2 grid grid-cols-4 gap-1 text-center text-xs tabular-nums">
              <div>
                <dt className="text-[10px] font-medium text-muted">{forLabel}</dt>
                <dd className="text-success">{p.for}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium text-muted">{againstLabel}</dt>
                <dd className="text-error">{p.against}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium text-muted">Abstain</dt>
                <dd className="text-muted">{p.abstain}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium text-muted">Total</dt>
                <dd className="font-medium">{p.total}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      <div className="hidden min-w-0 max-w-full overflow-x-auto overscroll-x-contain sm:block">
        <table className="w-full text-xs">
          <caption className="sr-only">{chamberLabel} vote tally</caption>
          <thead>
            <tr className="border-b border-card-border text-muted">
              <th className="text-left py-2 pr-4 font-medium">Party</th>
              <th className={numericHeadClass}>{forLabel}</th>
              <th className={numericHeadClass}>{againstLabel}</th>
              <th className={numericHeadClass}>Abstain</th>
              <th className={`${numericHeadClass} pl-2 pr-0`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {voteByParty.map((p) => (
              <tr key={p.party} className="border-b border-card-border/50 hover:bg-background/50">
                <td className="min-w-0 py-1.5 pr-4 font-medium">
                  <span className="flex min-w-0 items-start gap-1.5">
                    <span
                      className="mt-1 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: p.partyColor }}
                    />
                    <span className="min-w-0 break-words">{p.partyName}</span>
                  </span>
                </td>
                <td className={`${numericCellClass} text-success`}>{p.for}</td>
                <td className={`${numericCellClass} text-error`}>{p.against}</td>
                <td className={`${numericCellClass} text-muted`}>{p.abstain}</td>
                <td className={`${numericCellClass} pl-2 pr-0 font-medium`}>{p.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
