/**
 * NPP engine 6 bookkeeping: once a game day, fold each NPP CEO's company
 * results into its `ceoTrackRecord` (see `nppAutonomy/v6/rules/ceoTrackRecord`).
 *
 * Runs at every autonomy level because it changes no decision: it only writes
 * the record that v6 CEO selection reads. Reads the corporations and sectors
 * the corporation turn already loaded, then one `$in` read and one bulkWrite
 * on `npps`.
 */
import type { AnyBulkWriteOperation, Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { NPP } from "@/lib/db/types/npp";
import type { CorporationLookups } from "./types";
import {
  applyCeoSample,
  computeCeoSamples,
  isCeoRecordTurn,
  type NppCeoTrackRecord,
} from "@/lib/nppAutonomy/v6/rules/ceoTrackRecord";

/** Pure: the `npps` writes for this turn's samples against the stored records. */
export function buildCeoTrackRecordWrites(
  samples: ReturnType<typeof computeCeoSamples>,
  records: ReadonlyMap<string, NppCeoTrackRecord | undefined>,
  turn: number
): AnyBulkWriteOperation<NPP>[] {
  const setByNpp = new Map<string, Record<string, unknown>>();
  for (const sample of samples) {
    const prior = records.get(sample.nppId)?.[sample.lane];
    const next = applyCeoSample(prior, sample.relMarginPp, turn);
    if (next === prior) continue;
    const set = setByNpp.get(sample.nppId) ?? {};
    set[`ceoTrackRecord.${sample.lane}`] = next;
    setByNpp.set(sample.nppId, set);
  }
  return [...setByNpp].map(([nppId, set]) => ({
    updateOne: { filter: { _id: new ObjectId(nppId) }, update: { $set: set } },
  }));
}

export async function recordNppCeoTrackRecords(
  db: Db,
  lookups: Pick<CorporationLookups, "corporations" | "sectorsByCorp">,
  turn: number
): Promise<{ updated: number }> {
  if (!isCeoRecordTurn(turn)) return { updated: 0 };
  const samples = computeCeoSamples(lookups.corporations, lookups.sectorsByCorp);
  if (samples.length === 0) return { updated: 0 };

  const ids = [...new Set(samples.map((s) => s.nppId))]
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  const docs = await db
    .collection<NPP>("npps")
    .find({ _id: { $in: ids } })
    .project<{ _id: ObjectId; ceoTrackRecord?: NppCeoTrackRecord }>({ ceoTrackRecord: 1 })
    .toArray();
  const records = new Map(docs.map((d) => [d._id.toString(), d.ceoTrackRecord]));
  // Only NPPs that exist get a record; a ceoId that is not an NPP is skipped.
  const writes = buildCeoTrackRecordWrites(
    samples.filter((s) => records.has(s.nppId)),
    records,
    turn
  );
  if (writes.length === 0) return { updated: 0 };
  await db.collection<NPP>("npps").bulkWrite(writes, { ordered: false });
  return { updated: writes.length };
}
