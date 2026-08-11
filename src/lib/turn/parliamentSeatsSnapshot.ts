import type { Db } from "mongodb";
import type { ElectedOfficial } from "@/lib/db/types";

/**
 * Turns of seat history retained. 96 (two years at 48 turns/year) is the right
 * window for the live game's trend chart, but it truncates a long sim: a
 * 1000-turn run would keep only its last two years, so "who controlled the
 * legislature across twenty years" is unanswerable. The sim harness raises this
 * via SIM_SEAT_HISTORY_CAP; the live game is untouched by the default.
 */
const HISTORY_CAP = (() => {
  const raw = Number(process.env.SIM_SEAT_HISTORY_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 96;
})();

interface ParliamentSeatsSnapshot {
  _id: string;
  countryId: string;
  officeType: string;
  party: string;
  turn: number;
  seats: number;
  createdAt: Date;
}

/**
 * Snapshot seat counts by (country, officeType, party) once per turn — the
 * "seats over time" timeline for the sim experiments report. Mirrors
 * snapshotPartyHistory's exact storage pattern (src/lib/turn/
 * partyHistorySnapshot.ts): one doc per (countryId, officeType, party, turn)
 * with a composite _id, bulkWrite upsert, deleteMany pruning past
 * HISTORY_CAP turns.
 *
 * Deliberately covers EVERY country, not just status:"active" ones (unlike
 * snapshotPartyHistory, which is scoped to the live game's player-facing
 * trend chart) — the sim harness needs full coverage of whatever the
 * backfill (src/lib/sim/backfillMissingSeats.ts) populated, including
 * "coming-soon" countries.
 *
 * Seat count is summed via seatsHeld (falling back to 1 per doc) — NOT a
 * raw electedOfficials doc count. Getting this wrong was a real bug caught
 * earlier this session (src/lib/sim/metrics.ts's office-turnover metric,
 * and this file's own author's first read of the US House seat count):
 * multi-member office types (house/commons/etc.) can have one record
 * represent several seats.
 */
export async function snapshotParliamentSeats(db: Db, turn: number): Promise<number> {
  const rows = await db
    .collection<ElectedOfficial>("electedOfficials")
    .aggregate<{ _id: { countryId: string; officeType: string; party: string }; seats: number }>([
      { $match: { $or: [{ characterId: { $ne: null } }, { nppId: { $exists: true } }] } },
      {
        $group: {
          _id: {
            countryId: { $ifNull: ["$countryId", "US"] },
            officeType: "$officeType",
            party: { $ifNull: ["$party", "independent"] },
          },
          seats: { $sum: { $ifNull: ["$seatsHeld", 1] } },
        },
      },
    ])
    .toArray();

  if (rows.length === 0) return 0;

  const now = new Date();
  const ops = rows.map((row) => {
    const { countryId, officeType, party } = row._id;
    const id = `${countryId}:${officeType}:${party}:${turn}`;
    return {
      updateOne: {
        filter: { _id: id },
        update: {
          $set: {
            _id: id,
            countryId,
            officeType,
            party,
            turn,
            seats: row.seats,
            createdAt: now,
          },
        },
        upsert: true,
      },
    };
  });

  await db
    .collection<ParliamentSeatsSnapshot>("parliamentSeatsHistory")
    .bulkWrite(ops, { ordered: false });

  const minTurn = Math.max(1, turn - HISTORY_CAP + 1);
  await db.collection("parliamentSeatsHistory").deleteMany({ turn: { $lt: minTurn } });

  return ops.length;
}
