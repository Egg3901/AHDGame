export interface TurnBriefingItem {
  category: "markets" | "corporation" | "election";
  label: string;
  value: number;
  delta: number;
  unit: "currency" | "points" | "percent";
  href: string;
}

interface CorporationBriefingSource {
  sequentialId: number;
  history: {
    sharePrice: number;
    marketingStrength: number;
    liquidCapital: number;
  }[];
}

interface ElectionBriefingSource {
  electionId: string;
  history: { pct: number; seats: number | null }[];
}

function finiteDelta(current: number, previous: number): number | null {
  const delta = current - previous;
  return Number.isFinite(delta) && delta !== 0 ? delta : null;
}

/** Stable, data-only summary of the latest recorded turn. */
export function buildTurnBriefing(
  corporation: CorporationBriefingSource | null,
  election: ElectionBriefingSource | null
): TurnBriefingItem[] {
  const items: TurnBriefingItem[] = [];
  const corpHistory = corporation?.history ?? [];
  if (corporation && corpHistory.length >= 2) {
    const previous = corpHistory.at(-2)!;
    const current = corpHistory.at(-1)!;
    for (const [category, label, key, unit] of [
      ["markets", "Share price", "sharePrice", "currency"],
      ["corporation", "Liquid capital", "liquidCapital", "currency"],
      ["corporation", "Marketing strength", "marketingStrength", "points"],
    ] as const) {
      const delta = finiteDelta(current[key], previous[key]);
      if (delta != null)
        items.push({
          category,
          label,
          value: current[key],
          delta,
          unit,
          href: `/corporation/${corporation.sequentialId}`,
        });
    }
  }
  const electionHistory = election?.history ?? [];
  if (election && electionHistory.length >= 2) {
    const previous = electionHistory.at(-2)!;
    const current = electionHistory.at(-1)!;
    const voteDelta = finiteDelta(current.pct, previous.pct);
    if (voteDelta != null)
      items.push({
        category: "election",
        label: "Vote share",
        value: current.pct,
        delta: voteDelta,
        unit: "percent",
        href: `/elections/${election.electionId}`,
      });
    if (current.seats != null && previous.seats != null) {
      const seatDelta = finiteDelta(current.seats, previous.seats);
      if (seatDelta != null)
        items.push({
          category: "election",
          label: "Projected seats",
          value: current.seats,
          delta: seatDelta,
          unit: "points",
          href: `/elections/${election.electionId}`,
        });
    }
  }
  return items.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
}
