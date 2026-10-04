/**
 * National party mandates are assigned to district lists without changing
 * either the national quotas or district capacities. bgBalancedDistrictLists
 * uses a bounded proportional simulation, rather than claiming to reproduce
 * the commission's historical district adjustment procedure.
 */
export interface BgDistrictListBallot {
  id: string;
  seats: number;
  partyVotes: Readonly<Record<string, number>>;
}

export type BgDistrictListAllocation =
  | { kind: "allocated"; seatsByDistrict: Record<string, Record<string, number>> }
  | { kind: "deferred"; reason: "insufficient-district-list-support" };

interface Edge {
  to: number;
  reverse: number;
  capacity: number;
  cost: number;
}

/**
 * A minimum-cost integer flow allocates each party's fixed national quota.
 * The successive district-list costs are negative logs of D'Hondt quotients.
 * A zero-support list has no edge, so missing lists cannot acquire mandates.
 * Capacities are bounded to the ordinary240-seat Assembly.
 */
export function bgBalancedDistrictLists(
  ballots: readonly BgDistrictListBallot[],
  nationalPartySeats: Readonly<Record<string, number>>
): BgDistrictListAllocation {
  if (
    ballots.length === 0 ||
    ballots.length > 31 ||
    new Set(ballots.map((row) => row.id)).size !== ballots.length
  )
    throw new Error("Invalid Bulgarian electoral district coverage");
  const districts = [...ballots].sort((a, b) => a.id.localeCompare(b.id));
  const parties = Object.entries(nationalPartySeats).sort(([a], [b]) => a.localeCompare(b));
  let totalDistrictSeats = 0,
    totalPartySeats = 0;
  for (const district of districts) {
    if (
      !district.id ||
      !Number.isSafeInteger(district.seats) ||
      district.seats < 0 ||
      district.seats > 240
    )
      throw new Error("Invalid Bulgarian district capacity");
    totalDistrictSeats += district.seats;
    for (const [party, votes] of Object.entries(district.partyVotes))
      if (!party || !Number.isSafeInteger(votes) || votes < 0)
        throw new Error("Invalid Bulgarian district-list votes");
  }
  for (const [party, seats] of parties) {
    if (
      !party ||
      party === "independent" ||
      !Number.isSafeInteger(seats) ||
      seats < 0 ||
      seats > 240
    )
      throw new Error("Invalid Bulgarian national party quota");
    totalPartySeats += seats;
  }
  if (totalDistrictSeats !== totalPartySeats || totalPartySeats > 240)
    throw new Error("Bulgarian district and national party capacities disagree");
  const source = 0,
    firstDistrict = 1,
    firstParty = firstDistrict + districts.length;
  const sink = firstParty + parties.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const connect = (from: number, to: number, capacity: number, cost: number) => {
    const forward: Edge = { to, reverse: graph[to].length, capacity, cost };
    const reverse: Edge = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost };
    graph[from].push(forward);
    graph[to].push(reverse);
    return forward;
  };
  const listEdges: Array<{ districtId: string; party: string; edge: Edge }> = [];
  for (const [index, district] of districts.entries()) {
    connect(source, firstDistrict + index, district.seats, 0);
    for (const [partyIndex, [party, nationalSeats]] of parties.entries()) {
      const votes = district.partyVotes[party] ?? 0;
      if (votes === 0) continue;
      for (let ordinal = 1; ordinal <= Math.min(district.seats, nationalSeats); ordinal++) {
        const edge = connect(
          firstDistrict + index,
          firstParty + partyIndex,
          1,
          -Math.log(votes / ordinal)
        );
        listEdges.push({ districtId: district.id, party, edge });
      }
    }
  }
  for (const [index, [, seats]] of parties.entries()) connect(firstParty + index, sink, seats, 0);

  for (let mandate = 0; mandate < totalPartySeats; mandate++) {
    const distance = Array<number>(graph.length).fill(Infinity);
    const previousNode = Array<number>(graph.length).fill(-1);
    const previousEdge = Array<number>(graph.length).fill(-1);
    distance[source] = 0;
    // Bellman-Ford is bounded by vertices*edges and supports residual reversals.
    // Reversals let an earlier choice move instead of stranding another party.
    for (let pass = 0; pass < graph.length - 1; pass++) {
      let changed = false;
      for (let from = 0; from < graph.length; from++) {
        if (!Number.isFinite(distance[from])) continue;
        for (const [index, edge] of graph[from].entries()) {
          if (edge.capacity === 0) continue;
          const next = distance[from] + edge.cost;
          if (next < distance[edge.to] - 1e-10) {
            distance[edge.to] = next;
            previousNode[edge.to] = from;
            previousEdge[edge.to] = index;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    if (!Number.isFinite(distance[sink]))
      return { kind: "deferred", reason: "insufficient-district-list-support" };
    let node = sink,
      traversed = 0;
    while (node !== source) {
      if (previousNode[node] < 0 || ++traversed > graph.length)
        throw new Error("Bulgarian proportional flow cannot reconstruct a lawful mandate path");
      const from = previousNode[node];
      const edge = graph[from][previousEdge[node]];
      edge.capacity--;
      graph[node][edge.reverse].capacity++;
      node = from;
    }
  }
  const seatsByDistrict = Object.fromEntries(
    districts.map((row) => [row.id, Object.fromEntries(parties.map(([party]) => [party, 0]))])
  );
  for (const { districtId, party, edge } of listEdges)
    if (edge.capacity === 0) seatsByDistrict[districtId][party]++;
  return { kind: "allocated", seatsByDistrict };
}
