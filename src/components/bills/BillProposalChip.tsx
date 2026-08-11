/**
 * The pill that marks how an admin-tabled bill came to be. Normally an amber
 * "Admin Proposed" tag — but referendum consent bills (`category: "reunification"`)
 * are auto-tabled by a passed referendum, not proposed by an admin, so they get a
 * green "Referendum Passed" tag instead.
 */
export function BillProposalChip({
  adminProposed,
  category,
}: {
  adminProposed?: boolean;
  category?: string;
}) {
  if (!adminProposed) return null;
  if (category === "reunification") {
    return (
      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
        Referendum Passed
      </span>
    );
  }
  return (
    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
      Admin Proposed
    </span>
  );
}
