import { getDb } from "@/lib/mongodb";
import type { Election, GameState } from "@/lib/db/types";
import { openHu1991ByElections } from "./constituencyByElections1991";
import { bindHu1991Campaigns } from "./assemblyCampaignBinding1991";
import {
  easternBlocElectionsLive,
  ensureRegionalDelegateElections,
  seatsFromRegionField,
} from "@/lib/turn/perpetualElections/shared";
import { hu2014RegionSeats, HU_REFORM_YEAR } from "@/lib/turn/huAssemblyReform";

/** Hungary National Assembly. */
export async function ensureHUElections(now: Date, inFlightTurn?: number): Promise<void> {
  const db = await getDb();
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1, currentTurn: 1 } });
  if (game?.preset === "1991-default") {
    // Completed first rounds and their second rounds still belong to the same
    // mandate. Wait for whole-Assembly handover before scheduling a new term.
    const pending = await db.collection<Election>("elections").findOne(
      {
        countryId: "HU",
        electionType: "nationalAssembly",
        cycle: { $gte: 1 },
        status: "completed",
        $or: [{ electionYear: { $lt: 2014 } }, { electionYear: { $exists: false } }],
      },
      { projection: { _id: 1 } }
    );
    if (pending) {
      await bindHu1991Campaigns(db, now);
      return;
    }
  }
  if (game?.preset === "1991-default") {
    const activeByElection = await db.collection<Election>("elections").findOne(
      {
        countryId: "HU",
        electionType: "nationalAssembly",
        "hungarianAssemblyRound.byElection": { $exists: true },
        status: { $in: ["active", "upcoming"] },
      },
      { projection: { _id: 1 } }
    );
    if (activeByElection) {
      const currentTurn = inFlightTurn ?? game.currentTurn;
      if (
        !Number.isSafeInteger(currentTurn) ||
        currentTurn < 1 ||
        (await openHu1991ByElections(db, currentTurn, now)).length
      )
        return;
    }
  }
  await ensureRegionalDelegateElections(
    {
      countryId: "HU",
      electionType: "nationalAssembly",
      seatsForRegions: (regions, preset, _ctx, currentYear) =>
        preset === "1991-default" &&
        currentYear >= HU_REFORM_YEAR &&
        regions.reduce((sum, region) => sum + (region.houseDistricts ?? 0), 0) !== 199
          ? hu2014RegionSeats(regions)
          : seatsFromRegionField(regions, "houseDistricts"),
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: easternBlocElectionsLive,
      label: "National Assembly",
    },
    now,
    inFlightTurn
  );
  if (game?.preset === "1991-default") {
    await bindHu1991Campaigns(db, now);
    if (
      Number.isSafeInteger(inFlightTurn ?? game.currentTurn) &&
      (inFlightTurn ?? game.currentTurn) > 0
    )
      await openHu1991ByElections(db, inFlightTurn ?? game.currentTurn, now);
  }
}
