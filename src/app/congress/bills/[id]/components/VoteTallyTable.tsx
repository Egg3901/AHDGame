import type { VoteByParty } from "../types";

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
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">{chamberLabel} vote tally</caption>
        <thead>
          <tr className="border-b border-card-border text-muted">
            <th className="text-left py-2 pr-4 font-medium">Party</th>
            <th className="text-right py-2 px-2 font-medium tabular-nums">{forLabel}</th>
            <th className="text-right py-2 px-2 font-medium tabular-nums">{againstLabel}</th>
            <th className="text-right py-2 px-2 font-medium tabular-nums">Abstain</th>
            <th className="text-right py-2 pl-2 font-medium tabular-nums">Total</th>
          </tr>
        </thead>
        <tbody>
          {voteByParty.map((p) => (
            <tr key={p.party} className="border-b border-card-border/50 hover:bg-background/50">
              <td className="py-1.5 pr-4 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: p.partyColor }}
                  />
                  {p.partyName}
                </span>
              </td>
              <td className="text-right py-1.5 px-2 tabular-nums text-success">{p.for}</td>
              <td className="text-right py-1.5 px-2 tabular-nums text-error">{p.against}</td>
              <td className="text-right py-1.5 px-2 tabular-nums text-muted">{p.abstain}</td>
              <td className="text-right py-1.5 pl-2 tabular-nums font-medium">{p.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
