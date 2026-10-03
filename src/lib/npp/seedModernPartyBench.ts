/**
 * Modern default parties have an unseated NPC bench even without an authored
 * incumbent roster: see seedModernPartyBench. Generated actors carry no funds
 * or office and do not prescribe historical election winners.
 */
import type { Db } from "mongodb";
import type { Counter, GameState, NPP, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getAllCountryAccess } from "@/lib/countryAccess";
import { generateNPP, type NPPGenerationContext } from "./generator";

/** Supply an unseated candidate bench for required modern default parties. */
export async function seedModernPartyBench(
  db: Db,
  preset: string,
  log: (message: string) => void = () => {}
): Promise<number> {
  if (preset !== "1991-default" && preset !== "2019-default") return 0;
  const access = await getAllCountryAccess(db);
  const state = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { startingPartiesMode: 1 } });
  const noParties = state?.startingPartiesMode === "none";
  const parties = (
    await db
      .collection<PoliticalParty>("politicalParties")
      .find(
        { isDefault: true, memberCount: 0 },
        {
          projection: { sequentialId: 1, countryId: 1 },
        }
      )
      .toArray()
  )
    .map((party) => ({
      sequentialId: party.sequentialId,
      countryId: party.countryId ?? "US",
    }))
    .sort((a, b) => a.countryId.localeCompare(b.countryId) || a.sequentialId - b.sequentialId);
  // One projected population read supplies both membership and unique names.
  // Keep the bootstrap usable by the production and in-memory adapters.
  const liveNpps = await db
    .collection<NPP>("npps")
    .find(
      { retiredAt: null },
      {
        projection: { name: 1, party: 1, countryId: 1 },
      }
    )
    .toArray();
  const activeMembership = new Set(liveNpps.map((npp) => `${npp.countryId ?? "US"}:${npp.party}`));
  const required = parties.filter((party) => {
    if (activeMembership.has(`${party.countryId}:${party.sequentialId}`)) return false;
    if (!access[party.countryId]?.registered) {
      log(
        `Excluded ${party.countryId}:${party.sequentialId} from the bench: country is absent, dissolved or unregistered`
      );
      return false;
    }
    return !(noParties && ["US", "UK", "JP"].includes(party.countryId));
  });
  if (required.length === 0) return 0;
  const regions = await db
    .collection<{ _id: string; countryId: CountryId }>("states")
    .find(
      { countryId: { $in: [...new Set(required.map((p) => p.countryId))] } },
      {
        projection: { _id: 1, countryId: 1 },
      }
    )
    .sort({ _id: 1 })
    .toArray();
  const regionByCountry = new Map<CountryId, string>();
  const validRegions = new Set(regions.map((region) => `${region.countryId}:${region._id}`));
  for (const region of regions) {
    if (!regionByCountry.has(region.countryId)) regionByCountry.set(region.countryId, region._id);
  }
  for (const party of required) {
    if (!Number.isSafeInteger(party.sequentialId) || !regionByCountry.has(party.countryId)) {
      throw new Error(
        `Required modern party ${party.countryId}:${party.sequentialId} has no valid identity or authored region`
      );
    }
  }
  const orgs = await db
    .collection("statePartyOrg")
    .find(
      {
        countryId: { $in: [...new Set(required.map((party) => party.countryId))] },
        hasPresence: { $ne: false },
      },
      { projection: { countryId: 1, stateId: 1, partyId: 1, organization: 1 } }
    )
    .sort({ organization: -1, stateId: 1 })
    .toArray();
  const regionByParty = new Map<string, string>();
  for (const org of orgs) {
    const key = `${org.countryId}:${org.partyId}`;
    if (!regionByParty.has(key) && validRegions.has(`${org.countryId}:${org.stateId}`)) {
      regionByParty.set(key, org.stateId);
    }
  }
  const context: NPPGenerationContext = { existingNames: new Set(liveNpps.map((npp) => npp.name)) };
  const actors: NPP[] = [];
  for (const party of required) {
    actors.push(
      await generateNPP(
        {
          countryId: party.countryId,
          party: String(party.sequentialId),
          state:
            regionByParty.get(`${party.countryId}:${party.sequentialId}`) ??
            regionByCountry.get(party.countryId)!,
          year: Number(preset.slice(0, 4)),
        },
        context,
        db
      )
    );
  }
  const counter = await db
    .collection<Counter>("counters")
    .findOneAndUpdate(
      { _id: "npp" },
      { $inc: { seq: actors.length } },
      { upsert: true, returnDocument: "after" }
    );
  if (!counter) throw new Error("Failed to reserve modern party bench IDs");
  actors.forEach((actor, index) => {
    actor.sequentialId = counter.seq - actors.length + index + 1;
  });
  await db.collection<NPP>("npps").insertMany(actors);
  log(`Seeded ${actors.length} synthetic, unseated modern party bench actors`);
  return actors.length;
}
