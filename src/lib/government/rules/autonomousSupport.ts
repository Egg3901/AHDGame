/** Autonomous cabinets need compatible partners or recorded tolerance. */
export interface AutonomousParty {
  id: string;
  seats: number;
  economic: number | null;
  social: number | null;
}
export function planAutonomousSupport(
  parties: AutonomousParty[],
  leadPartyId: string,
  threshold: number
): { supporting: string[]; abstaining: string[]; seats: number } {
  const lead = parties.find((p) => p.id === leadPartyId);
  if (!lead) return { supporting: [], abstaining: [], seats: 0 };
  const supporting = [lead.id];
  let seats = lead.seats;
  const distance = (p: AutonomousParty) =>
    p.economic == null || p.social == null || lead.economic == null || lead.social == null
      ? Infinity
      : Math.hypot(p.economic - lead.economic, p.social - lead.social);
  const others = parties
    .filter((p) => p.id !== lead.id)
    .sort((a, b) => distance(a) - distance(b) || b.seats - a.seats || a.id.localeCompare(b.id));
  for (const party of others) {
    if (seats >= threshold) break;
    if (distance(party) <= 3) {
      supporting.push(party.id);
      seats += party.seats;
    }
  }
  // A minority can survive negative confidence only through identifiable
  // parties willing to tolerate it. Distant opposition still votes against.
  const abstaining = others
    .filter((p) => !supporting.includes(p.id) && distance(p) <= 5)
    .map((p) => p.id);
  return { supporting, abstaining, seats };
}

/** A defeated cabinet cannot be installed again against a known rejecting majority. */
export function chooseAutonomousCabinet(
  parties: AutonomousParty[],
  eligibleLeadIds: string[],
  threshold: number
) {
  const occupied = parties.reduce((sum, party) => sum + party.seats, 0);
  const leads = parties
    .filter((party) => eligibleLeadIds.includes(party.id))
    .sort((a, b) => b.seats - a.seats || a.id.localeCompare(b.id));
  for (const lead of leads) {
    const support = planAutonomousSupport(parties, lead.id, threshold);
    const abstainingSeats = parties
      .filter((party) => support.abstaining.includes(party.id))
      .reduce((sum, party) => sum + party.seats, 0);
    if (support.seats > 0 && support.seats >= occupied - support.seats - abstainingSeats)
      return { leadPartyId: lead.id, ...support };
  }
  return null;
}
