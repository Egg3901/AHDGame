import { PartyChip, type PartyLite } from "./PartyChip";

function Column({ title, tone, parties }: { title: string; tone: string; parties: PartyLite[] }) {
  return (
    <div className="flex-1">
      <div className={`mb-2 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
        {title} · {parties.length}
      </div>
      {parties.length ? (
        <div className="flex flex-wrap gap-1.5">
          {parties.map((p) => (
            <PartyChip key={p.partyId} party={p} />
          ))}
        </div>
      ) : (
        <div className="text-[12.5px] font-bold text-muted">—</div>
      )}
    </div>
  );
}

/** For / Against / Undeclared blocs of declared party positions. */
export function PartyPositions({
  forParties,
  againstParties,
  undeclared,
  labels = { yes: "Yes", no: "No" },
}: {
  forParties: PartyLite[];
  againstParties: PartyLite[];
  undeclared: PartyLite[];
  labels?: { yes: string; no: string };
}) {
  return (
    <div className="rounded-2xl border border-card-border bg-card p-5 shadow-card">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted">
        Party positions
      </h2>
      <div className="flex flex-col gap-5 sm:flex-row">
        <Column title={`For · ${labels.yes}`} tone="text-[var(--ref-yes)]" parties={forParties} />
        <Column
          title={`Against · ${labels.no}`}
          tone="text-[var(--ref-no)]"
          parties={againstParties}
        />
        <Column title="Undeclared" tone="text-muted" parties={undeclared} />
      </div>
    </div>
  );
}
