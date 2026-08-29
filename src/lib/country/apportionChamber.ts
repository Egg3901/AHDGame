/**
 * Seat a region's officials into the chamber their region now belongs to.
 *
 * SHARED BY TWO CALLERS, which is the reason it is not inline in either. A
 * country merge carries officials across a border into a chamber sized by the
 * target's seed; a region merge fuses two delegations into one chamber that is
 * sized for a single region. Both end with the same question -- these people
 * hold these shares, the chamber holds this many seats, who gets what -- and a
 * second implementation of that answer would drift from the first.
 *
 * Spec: docs/superpowers/specs/2026-08-29-reunification-merge-design.md
 */
import type { Db, ObjectId } from "mongodb";
import { apportionSeats } from "./seatApportionment";

/** One official as the apportionment reads it. */
export interface ChamberOfficial {
  _id: ObjectId;
  party?: string;
  seatsHeld?: number;
}

export interface ApportionChamberParams {
  /** The country the chamber belongs to. */
  countryId: string;
  /** The region whose delegation this is. */
  regionId: string;
  /** The office these officials hold once seated, e.g. `bundestag`. */
  officeType: string;
  /** Everyone landing in this chamber, from every source region. */
  officials: ChamberOfficial[];
  /** Extra `$set` fields written alongside the seat count. */
  extraSet?: Record<string, unknown>;
  now: Date;
}

/**
 * Write each official's share of the chamber, returning how many were seated.
 *
 * The chamber's `totalSeats` is authoritative and SEEDED, not derived -- Germany
 * already carries `DE-bundestag-SN` and friends precisely so a reunified
 * Bundestag has a sized chamber waiting. When no seat document exists, or when
 * nobody in the group holds seats at all (a minister-president is not a seat),
 * the counts are left exactly as they are: apportioning then would invent a
 * magnitude for an office that has none.
 */
export async function apportionOfficialsToChamber(
  db: Db,
  params: ApportionChamberParams
): Promise<number> {
  const { countryId, regionId, officeType, officials, extraSet, now } = params;
  if (officials.length === 0) return 0;

  const seatDoc = (await db
    .collection("seats")
    .findOne({ countryId, state: regionId, electionType: officeType })) as {
    totalSeats?: number;
  } | null;

  const carriesSeats = officials.some((o) => (o.seatsHeld ?? 0) > 0);
  let allocation: Record<string, number> | null = null;
  if (seatDoc?.totalSeats && carriesSeats) {
    const sourceByParty: Record<string, number> = {};
    for (const o of officials) {
      const key = o.party ?? "independent";
      sourceByParty[key] = (sourceByParty[key] ?? 0) + (o.seatsHeld ?? 0);
    }
    allocation = apportionSeats(sourceByParty, seatDoc.totalSeats);
  }

  // Split each party's allocation across the rows that party holds here. Largest
  // remainder again, keyed by row id, so two officials sharing one delegation
  // split it identically on every run.
  const rowsByParty = new Map<string, ChamberOfficial[]>();
  for (const o of officials) {
    const key = o.party ?? "independent";
    const rows = rowsByParty.get(key) ?? [];
    rows.push(o);
    rowsByParty.set(key, rows);
  }

  let seated = 0;
  for (const [party, rows] of rowsByParty) {
    const ordered = [...rows].sort((a, b) => (String(a._id) < String(b._id) ? -1 : 1));
    const share =
      allocation && allocation[party] !== undefined
        ? apportionSeats(
            Object.fromEntries(ordered.map((o) => [String(o._id), o.seatsHeld ?? 1])),
            allocation[party]
          )
        : null;
    for (const o of ordered) {
      await db.collection("electedOfficials").updateOne(
        { _id: o._id },
        {
          $set: {
            ...extraSet,
            ...(share ? { seatsHeld: share[String(o._id)] ?? 0 } : {}),
            updatedAt: now,
          },
        }
      );
      seated++;
    }
  }
  return seated;
}
