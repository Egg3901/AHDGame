import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import { ruRegions1991 } from "@/lib/countries/ru/data/ruRegions1991";
import { plRegions1991 } from "@/lib/countries/pl/data/plRegions1991";
import { csRegions1991 } from "@/lib/countries/cs/data/csRegions1991";
import { huRegions1991 } from "@/lib/countries/hu/data/huRegions1991";
import { roRegions1991 } from "@/lib/countries/ro/data/roRegions1991";
import { bgRegions1991 } from "@/lib/countries/bg/data/bgRegions1991";
import { yuRegions1991 } from "@/lib/countries/yu/data/yuRegions1991";

const BUNDLES = [
  ruRegions1991,
  plRegions1991,
  csRegions1991,
  huRegions1991,
  roRegions1991,
  bgRegions1991,
  yuRegions1991,
];

/** Upsert the 1991 successor states before region-derived seed stages run. */
export async function seedSuccessorRegions1991(
  db: Db,
  reset: boolean,
  preset: string,
  log: (message: string) => void
): Promise<void> {
  if (preset !== "1991-default") return;
  const states = db.collection<State>("states");
  for (const bundle of BUNDLES) {
    const countryId = bundle[0]?.countryId;
    if (!countryId) throw new Error("Empty 1991 successor region bundle");
    if (reset) await states.deleteMany({ countryId });
    await states.bulkWrite(
      bundle.map(({ _id, ...data }) => ({
        updateOne: { filter: { _id }, update: { $set: data }, upsert: true },
      }))
    );
    log(`[${countryId}] seeded ${bundle.length} January 1991 regions`);
  }
}
