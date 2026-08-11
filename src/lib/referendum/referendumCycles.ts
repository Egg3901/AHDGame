/**
 * Cycle helpers for the dedicated Referendums pages. A region's referendums form
 * a chronological series (cycle 1..N by `requestedTurn`), mirroring how elections
 * snapshot history under `?cycle=N`. The detail page resolves one cycle and its
 * Prev/Next neighbours; the index lists a country's active campaigns + past votes.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Referendum } from "@/lib/db/types/referendum";
import type { PollPoint } from "@/lib/referendum/pollSnapshot";
import { getReferendumCollection } from "@/lib/db/collections/referendum";

const TERMINAL = new Set(["declined", "settled", "completed", "cancelled"]);

/** Chronological order: requestedTurn asc, createdAt as a stable tiebreak. */
function ordered(refs: Referendum[]): Referendum[] {
  return [...refs].sort(
    (a, b) =>
      (a.requestedTurn ?? 0) - (b.requestedTurn ?? 0) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

export interface ResolvedReferendumCycle {
  referendum: Referendum;
  cycle: number;
  totalCycles: number;
  prevCycle: number | null;
  nextCycle: number | null;
}

/**
 * Resolve a region's referendum at `cycle` (1-indexed by chronological order),
 * or the latest when `cycle` is omitted. Returns null when the region has no
 * referendums or the cycle is out of range.
 */
export async function resolveRegionReferendumByCycle(
  db: Db,
  countryId: CountryId,
  regionId: string,
  cycle?: number
): Promise<ResolvedReferendumCycle | null> {
  const all = ordered(
    await getReferendumCollection(db)
      .find({ countryId, regionId: regionId.toUpperCase() })
      .sort({ requestedTurn: 1 })
      .toArray()
  );
  if (all.length === 0) return null;
  const idx = cycle == null ? all.length - 1 : cycle - 1;
  if (idx < 0 || idx >= all.length) return null;
  return {
    referendum: all[idx],
    cycle: idx + 1,
    totalCycles: all.length,
    prevCycle: idx > 0 ? idx : null,
    nextCycle: idx < all.length - 1 ? idx + 2 : null,
  };
}

export interface CountryReferendumRow {
  regionId: string;
  cycle: number;
  kind: Referendum["kind"];
  status: Referendum["status"];
  yesShare: number;
  pollHistory: PollPoint[];
  positionCounts: { for: number; against: number; undeclared: number };
  campaignCloseTurn: number | null;
  referendumId: string;
}

/**
 * A country's referendums split into `active` (currently campaigning) and `past`
 * (terminal: declined/settled/completed/cancelled), each row carrying its region
 * cycle number for deep-linking. In-progress non-campaigning phases (requested /
 * granted / polling / actuating) appear in neither list.
 */
export async function listCountryReferendums(
  db: Db,
  countryId: CountryId
): Promise<{ active: CountryReferendumRow[]; past: CountryReferendumRow[] }> {
  const all = await getReferendumCollection(db).find({ countryId }).toArray();

  // Org-present party count per region (active campaigns only), to derive each
  // active row's "undeclared" tally = org parties that have not declared.
  const activeRegionIds = [
    ...new Set(all.filter((r) => r.status === "campaigning").map((r) => r.regionId)),
  ];
  const orgRows = activeRegionIds.length
    ? await db
        .collection<{ stateId: string }>("statePartyOrg")
        .find({ countryId, stateId: { $in: activeRegionIds } })
        .toArray()
    : [];
  const orgCountByRegion = new Map<string, number>();
  for (const row of orgRows) {
    orgCountByRegion.set(row.stateId, (orgCountByRegion.get(row.stateId) ?? 0) + 1);
  }

  const byRegion = new Map<string, Referendum[]>();
  for (const r of all) {
    byRegion.set(r.regionId, [...(byRegion.get(r.regionId) ?? []), r]);
  }
  const active: CountryReferendumRow[] = [];
  const past: CountryReferendumRow[] = [];
  for (const [, refs] of byRegion) {
    ordered(refs).forEach((r, i) => {
      const positions = r.partyPositions ?? [];
      const forN = positions.filter((p) => p.side === "yes").length;
      const againstN = positions.filter((p) => p.side === "no").length;
      const org = orgCountByRegion.get(r.regionId) ?? 0;
      const row: CountryReferendumRow = {
        regionId: r.regionId,
        cycle: i + 1,
        kind: r.kind,
        status: r.status,
        yesShare: r.yesShare,
        pollHistory: r.pollHistory ?? [],
        positionCounts: {
          for: forN,
          against: againstN,
          undeclared: Math.max(0, org - forN - againstN),
        },
        campaignCloseTurn: r.campaignCloseTurn,
        referendumId: String(r._id),
      };
      if (r.status === "campaigning") active.push(row);
      else if (TERMINAL.has(r.status)) past.push(row);
    });
  }
  return { active, past };
}
