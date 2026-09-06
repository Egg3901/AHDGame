import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types/corporation";
import type { NPP } from "@/lib/db/types/npp";

/** Convert human-run corporations in a restored clone, unless the player rail is preserved. */
export async function applyCloneControllerPolicy(
  db: Db,
  logFn: (message: string) => void,
  preservePlayerRail: boolean
): Promise<number> {
  if (preservePlayerRail) {
    logFn("[clone] preserved existing corporation controllers (--preserve-player-rail)");
    return 0;
  }

  const nppRows = await db
    .collection<NPP>("npps")
    .find({ retiredAt: null }, { projection: { _id: 1, countryId: 1 } })
    .toArray();
  const byCountry = new Map<string, unknown[]>();
  for (const n of nppRows) {
    const pool = byCountry.get(n.countryId) ?? [];
    pool.push(n._id);
    byCountry.set(n.countryId, pool);
  }
  const rr = new Map<string, number>();
  const cursor = db.collection<Corporation>("corporations").find({
    ceoType: { $in: ["character", "player", null] },
    countryOwnerId: { $exists: false },
  });
  let converted = 0;
  let noNpp = 0;
  for await (const corp of cursor) {
    const pool = byCountry.get(corp.countryId) ?? [];
    const roundRobinIndex = rr.get(corp.countryId) ?? 0;
    const ceoId = pool.length ? pool[roundRobinIndex % pool.length] : corp.ceoId;
    if (!pool.length) noNpp++;
    rr.set(corp.countryId, (rr.get(corp.countryId) ?? 0) + 1);
    await db.collection<Corporation>("corporations").updateOne(
      { _id: corp._id },
      {
        $set: { ceoType: "npp", ceoId, ceoVacant: false, ceoSalary: 0, updatedAt: new Date() },
        $unset: { pendingCeoCharacterId: "" },
      }
    );
    converted++;
  }
  if (noNpp > 0)
    logFn(`[clone] ${noNpp} corp(s) had no in-country NPP; kept prior ceoId, default personality`);
  return converted;
}
