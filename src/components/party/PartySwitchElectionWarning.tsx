export const PARTY_SWITCH_ELECTION_WARNING =
  "Switching parties during an election will withdraw you from every active election.";

export function PartySwitchElectionWarning({ className = "" }: { className?: string }) {
  return (
    <p
      role="note"
      className={`rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning ${className}`.trim()}
    >
      {PARTY_SWITCH_ELECTION_WARNING}
    </p>
  );
}
