export interface PartyLite {
  partyId: string;
  abbreviation: string;
  color: string;
  name: string;
}

/** A small party pill: abbreviation on the party's colour. */
export function PartyChip({ party }: { party: PartyLite }) {
  return (
    <span
      title={party.name}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold text-white"
      style={{ background: party.color }}
    >
      {party.abbreviation}
    </span>
  );
}
