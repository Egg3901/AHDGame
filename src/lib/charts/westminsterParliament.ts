/**
 * Maps party seat data to the layout expected by westminster-svg (House of Commons style).
 * Supports two modes:
 * - Economic position mode: left/right based on economicPosition
 * - Government mode: government on right, opposition on left, others on crossbenches
 */
import generate from "westminster-svg";
import { toHtml } from "hast-util-to-html";
import type { Root } from "hast";

export type WestminsterPartySeat = {
  party: string;
  partyColor: string;
  economicPosition: number | null;
  seats: number;
};

/** Government formation context for seating arrangement */
export type GovernmentContext = {
  /** Party IDs in the governing coalition (or single governing party) */
  governingParties: Set<string>;
  /** Party ID of the official opposition (largest non-governing party) */
  officialOpposition?: string;
  /** Party IDs of additional opposition parties (1-2 largest after official opposition) */
  additionalOpposition?: string[];
};

type WestminsterSide = Record<string, { seats: number; colour: string }>;

function sortLR<T extends { economicPosition: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.economicPosition ?? 0) - (b.economicPosition ?? 0));
}

/**
 * Build westminster-svg `parliament` object from party rows using government/opposition layout.
 * - Government coalition sits on the right (traditionally the government bench)
 * - Official opposition sits on the left
 * - Additional opposition (1-2 largest parties) sit on left or crossbenches
 * - Remaining parties and vacant seats on crossbenches
 */
export function buildWestminsterParliament(
  seats: WestminsterPartySeat[],
  totalChamberSeats: number,
  vacantColor: string,
  governmentContext?: GovernmentContext
): {
  headBench: WestminsterSide;
  left: WestminsterSide;
  right: WestminsterSide;
  crossBench: WestminsterSide;
} {
  const filled = seats.reduce((s, p) => s + p.seats, 0);
  const vacant = Math.max(0, totalChamberSeats - filled);

  const rows = seats.map((p) => ({
    party: p.party,
    colour: p.partyColor,
    economicPosition: p.economicPosition,
    seats: p.seats,
  }));

  // If government context is provided, use government/opposition seating
  if (governmentContext) {
    const { governingParties, officialOpposition, additionalOpposition = [] } = governmentContext;

    const governmentRows = rows.filter((r) => governingParties.has(r.party));
    const oppositionRows = rows.filter(
      (r) =>
        !governingParties.has(r.party) &&
        (r.party === officialOpposition || additionalOpposition.includes(r.party))
    );
    const crossbenchRows = rows.filter(
      (r) =>
        !governingParties.has(r.party) &&
        r.party !== officialOpposition &&
        !additionalOpposition.includes(r.party)
    );

    // Sort government by seats descending (largest first)
    governmentRows.sort((a, b) => b.seats - a.seats);
    // Sort opposition by seats descending
    oppositionRows.sort((a, b) => b.seats - a.seats);
    // Sort crossbench by seats descending
    crossbenchRows.sort((a, b) => b.seats - a.seats);

    const right: WestminsterSide = {};
    for (const r of governmentRows) {
      right[r.party] = { seats: r.seats, colour: r.colour };
    }

    const left: WestminsterSide = {};
    for (const r of oppositionRows) {
      left[r.party] = { seats: r.seats, colour: r.colour };
    }

    const crossBench: WestminsterSide = {};
    for (const r of crossbenchRows) {
      crossBench[r.party] = { seats: r.seats, colour: r.colour };
    }
    if (vacant > 0) {
      crossBench.__vacant__ = { seats: vacant, colour: vacantColor };
    }

    return {
      headBench: {},
      left,
      right,
      crossBench,
    };
  }

  // Fallback to economic position-based seating
  const leftRows = sortLR(rows.filter((r) => (r.economicPosition ?? 0) < 0));
  const rightRows = sortLR(rows.filter((r) => (r.economicPosition ?? 0) > 0));
  const centerRows = sortLR(rows.filter((r) => (r.economicPosition ?? 0) === 0));

  const left: WestminsterSide = {};
  for (const r of leftRows) {
    left[r.party] = { seats: r.seats, colour: r.colour };
  }

  const right: WestminsterSide = {};
  for (const r of rightRows) {
    right[r.party] = { seats: r.seats, colour: r.colour };
  }

  const crossBench: WestminsterSide = {};
  for (const r of centerRows) {
    crossBench[r.party] = { seats: r.seats, colour: r.colour };
  }
  if (vacant > 0) {
    crossBench.__vacant__ = { seats: vacant, colour: vacantColor };
  }

  return {
    headBench: {},
    left,
    right,
    crossBench,
  };
}

/**
 * Returns an SVG string for the Westminster-style chamber chart, or null if there are no seats to show.
 */
export function westminsterParliamentSvgString(
  seats: WestminsterPartySeat[],
  totalChamberSeats: number,
  vacantColor: string,
  governmentContext?: GovernmentContext
): string | null {
  if (totalChamberSeats <= 0) return null;

  const parliament = buildWestminsterParliament(
    seats,
    totalChamberSeats,
    vacantColor,
    governmentContext
  );
  const tree: Root = generate(parliament);
  return toHtml(tree);
}
