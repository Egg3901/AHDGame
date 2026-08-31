/** What this branch would actually do to the live world on its first turn. */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { repairedIntegrity, isResting, repairRate, freeRepairCeiling } from "@/lib/navair/repair";
import { WITHDRAW_INTEGRITY } from "@/lib/navair/missions";
import { homeRegionOf } from "@/lib/military/regionTopology";
import { supplyCeiling } from "@/lib/navair/basing";
import type { NavairUnit } from "@/lib/navair/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
async function main() {
  const uri = process.env.MONGODB_URI_LIVE!;
  const client = new MongoClient(
    uri.includes("directConnection")
      ? uri
      : `${uri}${uri.includes("?") ? "&" : "?"}directConnection=true`
  );
  await client.connect();
  const db = client.db();
  const units = (await db
    .collection<MilitaryUnit>("militaryUnits")
    .find({ domain: { $in: ["naval", "air"] } })
    .toArray()) as unknown as NavairUnit[];

  console.log(
    "| country | formation | integ | supply | station | withdraws? | new supply | integ after |"
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  let moved = 0;
  let mended = 0;
  for (const u of units) {
    const before = u.integrity ?? 100;
    if (before >= 100) continue;
    const withdrawing = before < WITHDRAW_INTEGRITY && u.stationSetByPlayer !== true;
    const station = withdrawing ? (homeRegionOf(u.countryId) ?? u.station) : u.station;
    if (!station) continue;
    // Peacetime basing read: no hostility map here, so "home" when it is the home region.
    const basing = homeRegionOf(u.countryId) === station ? "home" : "neutral";
    const supply =
      withdrawing || before <= 0
        ? supplyCeiling({ ...u, station } as NavairUnit, basing, 0, false)
        : (u.supply ?? 100);
    const after = withdrawing
      ? repairedIntegrity({ ...u, station, supply, mission: "PORT" } as NavairUnit, basing)
      : repairedIntegrity({ ...u, supply } as NavairUnit, basing);
    if (station !== u.station) moved++;
    if (after > before) mended++;
    console.log(
      `| ${u.countryId} | ${u.name} | ${before.toFixed(0)} | ${(u.supply ?? 100).toFixed(0)} | ${u.station} | ${withdrawing ? "yes -> " + station : "no"} | ${supply.toFixed(0)} | ${after.toFixed(1)} |`
    );
  }
  console.log(`\n${moved} formations withdraw home, ${mended} mend on the first turn.`);
  await client.close();
}
void main();
