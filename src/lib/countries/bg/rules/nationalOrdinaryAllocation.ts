/**
 * Bulgaria's ordinary Assembly allocates party mandates nationally before
 * personifying them through district lists. bgNationalOrdinaryQuotas applies
 * the nationwide four-percent gate and D'Hondt to the remaining party seats.
 * https://www.math.bas.bg/smb/2014_PK/tom_2014/pdf/124-131.pdf
 */
export interface BgNationalOrdinaryQuotas {
  partySeats: Record<string, number>;
  eligibleParties: string[];
  independentSeats: number;
  unallocatedSeats: number;
}

export function bgNationalOrdinaryQuotas(input: {
  partyVotes: Readonly<Record<string, number>>;
  totalValidVotes: number;
  totalSeats: number;
  independentSeats: number;
}): BgNationalOrdinaryQuotas {
  const { partyVotes, totalValidVotes, totalSeats, independentSeats } = input;
  if (
    !Number.isSafeInteger(totalValidVotes) ||
    totalValidVotes <= 0 ||
    !Number.isSafeInteger(totalSeats) ||
    totalSeats < 1 ||
    totalSeats > 240 ||
    !Number.isSafeInteger(independentSeats) ||
    independentSeats < 0 ||
    independentSeats > totalSeats
  )
    throw new Error("Invalid Bulgarian national allocation capacity or vote total");
  const parties = Object.entries(partyVotes).sort(([a], [b]) => a.localeCompare(b));
  let accountedVotes = 0n;
  for (const [party, votes] of parties) {
    if (!party || party === "independent" || !Number.isSafeInteger(votes) || votes < 0)
      throw new Error("Invalid Bulgarian party vote total");
    accountedVotes += BigInt(votes);
  }
  if (accountedVotes > BigInt(totalValidVotes))
    throw new Error("Bulgarian party votes exceed all valid votes");
  const eligible = parties.filter(([, votes]) => BigInt(votes) * 25n >= BigInt(totalValidVotes));
  const partySeats = Object.fromEntries(parties.map(([party]) => [party, 0]));
  const remaining = totalSeats - independentSeats;
  if (eligible.length === 0)
    return { partySeats, eligibleParties: [], independentSeats, unallocatedSeats: remaining };
  const counts = eligible.map(([id, votes]) => ({ id, votes: BigInt(votes), seats: 0 }));
  for (let mandate = 0; mandate < remaining; mandate++) {
    let best = counts[0];
    for (const row of counts.slice(1)) {
      const comparison = row.votes * BigInt(best.seats + 1) - best.votes * BigInt(row.seats + 1);
      if (comparison > 0n || (comparison === 0n && row.votes > best.votes)) best = row;
    }
    best.seats++;
  }
  for (const row of counts) partySeats[row.id] = row.seats;
  return {
    partySeats,
    eligibleParties: eligible.map(([party]) => party),
    independentSeats,
    unallocatedSeats: 0,
  };
}
