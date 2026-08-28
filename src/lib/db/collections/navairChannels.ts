import type { Db, AnyBulkWriteOperation } from "mongodb";
import type { NavairChannelDoc } from "@/lib/navair/types";
import type { CountryId } from "@/lib/constants/countries";
import type { RegionCode } from "@/lib/military/types";
import { channelKey, emptyChannels } from "@/lib/navair/channels";
import type { RegionChannels } from "@/lib/navair/types";

export function getNavairChannelsCollection(db: Db) {
  return db.collection<NavairChannelDoc>("navairChannels");
}

/**
 * Every country's regional channel state, keyed `countryId:region`.
 *
 * Loaded whole once per turn rather than queried per country per region: there are 19
 * regions and the row count is bounded by countries that actually own a fleet or an air
 * force, so this is small, and the alternative is hundreds of round trips inside a phase
 * that already has a turn-time budget.
 */
export async function loadNavairChannels(db: Db): Promise<Map<string, RegionChannels>> {
  const docs = await getNavairChannelsCollection(db).find({}).toArray();
  const map = new Map<string, RegionChannels>();
  for (const d of docs) {
    map.set(channelKey(d.countryId, d.region), {
      airSuperiority: d.airSuperiority,
      seaControl: d.seaControl,
      detection: d.detection,
      updatedTurn: d.updatedTurn,
    });
  }
  return map;
}

/**
 * Read one country's channels in a region, defaulting rather than throwing.
 *
 * A region nobody has contested has no row, and that is not an error: it means zero
 * control, which is exactly what `emptyChannels` returns. Never persisted on read, so a
 * world that never fights never writes this collection at all.
 */
export function channelsFor(
  channels: ReadonlyMap<string, RegionChannels>,
  countryId: CountryId,
  region: RegionCode,
  turn: number
): RegionChannels {
  return channels.get(channelKey(countryId, region)) ?? emptyChannels(turn);
}

/** Persist the turn's channel movement in one bulk write. */
export async function saveNavairChannels(
  db: Db,
  updates: ReadonlyArray<{ countryId: CountryId; region: RegionCode; channels: RegionChannels }>
): Promise<number> {
  if (!updates.length) return 0;
  const ops: AnyBulkWriteOperation<NavairChannelDoc>[] = updates.map((u) => ({
    updateOne: {
      filter: { countryId: u.countryId, region: u.region },
      update: {
        $set: {
          airSuperiority: u.channels.airSuperiority,
          seaControl: u.channels.seaControl,
          detection: u.channels.detection,
          updatedTurn: u.channels.updatedTurn,
        },
      },
      upsert: true,
    },
  }));
  const res = await getNavairChannelsCollection(db).bulkWrite(ops, { ordered: false });
  return (res.modifiedCount ?? 0) + (res.upsertedCount ?? 0);
}
