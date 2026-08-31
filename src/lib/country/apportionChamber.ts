/**
 * Rescale a region's delegation onto the chamber it now belongs to.
 *
 * SHARED BY TWO CALLERS, which is why it is not inline in either. A country
 * merge carries a delegation across a border into a chamber sized by the target;
 * a region merge fuses two delegations into the one chamber that survives. Both
 * end with the same question -- these people hold these shares, the chamber holds
 * this many seats, who gets what -- and a second implementation would drift.
 *
 * ⚠️ CHAMBER SIZE COMES FROM THE `states` DOCUMENT, NOT FROM `seats`.
 *
 * `getLiveLowerChamberSeats` sums each region's `houseDistricts` to get the
 * country's lower chamber, and `electedOfficials.seatsHeld` totals to that same
 * number -- Germany's 487. The `seats` collection is a DIFFERENT quantity: a
 * `DE-bundestag-<Land>` document holds that Land's Wahlkreis count under the
 * additive-member system (299 across Germany, against 487 seats). Berlin's seat
 * document says 12 while its `houseDistricts` is 25. Sizing a delegation from
 * the seat document therefore halves it.
 *
 * `stateSenateSeats` happens to equal its landtag seat document exactly, which
 * is what makes the confusion easy to fall into and hard to notice.
 *
 * Spec: docs/superpowers/specs/2026-08-29-reunification-merge-design.md
 */
import type { Db, ObjectId } from "mongodb";
import type { State } from "@/lib/db/types";
import { apportionSeats } from "./seatApportionment";

/** One official as the apportionment reads it. */
export interface ChamberOfficial {
  _id: ObjectId;
  party?: string;
  seatsHeld?: number;
}

/**
 * Which field on the region's `states` document sizes each chamber.
 *
 * An office absent from this table holds no seats -- a Minister-President is an
 * executive, not a delegation -- and its `seatsHeld` is left exactly as it is.
 */
const CHAMBER_SIZE_FIELD: Record<string, "houseDistricts" | "stateSenateSeats"> = {
  bundestag: "houseDistricts",
  landtag: "stateSenateSeats",
};

export interface ApportionChamberParams {
  /** The region whose delegation this is; its `states` doc sizes the chamber. */
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
 * Read the region's size AFTER whatever set it: `convertRegionDoc` sizes a
 * joining region by population share, and a region merge sums two. Calling this
 * before that write apportions onto the region's OLD country's chamber.
 */
export async function apportionOfficialsToChamber(
  db: Db,
  params: ApportionChamberParams
): Promise<number> {
  const { regionId, officeType, officials, extraSet, now } = params;
  if (officials.length === 0) return 0;

  const sizeField = CHAMBER_SIZE_FIELD[officeType];
  let allocation: Record<string, number> | null = null;

  // An office with no chamber (an executive) has no magnitude to rescale, and one
  // where nobody holds seats has nothing to rescale either. Apportioning in either
  // case would invent a seat count for something that is not a seat.
  const carriesSeats = officials.some((o) => (o.seatsHeld ?? 0) > 0);
  if (sizeField && carriesSeats) {
    const region = await db
      .collection<State>("states")
      .findOne({ _id: regionId }, { projection: { houseDistricts: 1, stateSenateSeats: 1 } });
    const total = (region as Record<string, unknown> | null)?.[sizeField];
    if (typeof total === "number" && total > 0) {
      const sourceByParty: Record<string, number> = {};
      for (const o of officials) {
        const key = o.party ?? "independent";
        sourceByParty[key] = (sourceByParty[key] ?? 0) + (o.seatsHeld ?? 0);
      }
      allocation = apportionSeats(sourceByParty, total);
    }
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

/**
 * Re-apportion every delegation seated in a region onto that region's current
 * chamber sizes.
 *
 * Called after the region's size is settled -- by `convertRegionDoc` when it
 * joins a country, or by a region merge that summed two. Splitting this from the
 * office remap is what lets the remap run early (it is part of evacuating the
 * region) while the arithmetic waits for the number it depends on.
 */
export async function rescaleRegionDelegations(
  db: Db,
  params: { regionId: string; countryId: string; now?: Date }
): Promise<number> {
  const { regionId, countryId } = params;
  const now = params.now ?? new Date();

  const officials = (await db
    .collection("electedOfficials")
    .find({ countryId, state: regionId })
    .toArray()) as unknown as Array<ChamberOfficial & { officeType: string }>;
  if (officials.length === 0) return 0;

  const byOffice = new Map<string, Array<ChamberOfficial & { officeType: string }>>();
  for (const o of officials) {
    const group = byOffice.get(o.officeType) ?? [];
    group.push(o);
    byOffice.set(o.officeType, group);
  }

  let rescaled = 0;
  for (const [officeType, group] of byOffice) {
    rescaled += await apportionOfficialsToChamber(db, {
      regionId,
      officeType,
      officials: group,
      now,
    });
  }
  return rescaled;
}
