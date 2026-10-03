import { advanceHu1991ListVacancy } from "./listVacancies1991";
import { getDb } from "@/lib/mongodb";
import type { CountryGameState, Election, GameState } from "@/lib/db/types";
import { openHu1991ByElections } from "./constituencyByElections1991";
import { bindHu1991Campaigns } from "./assemblyCampaignBinding1991";
import {
  easternBlocElectionsLive,
  ensureRegionalDelegateElections,
  seatsFromRegionField,
} from "@/lib/turn/perpetualElections/shared";
import { hu2014RegionSeats } from "@/lib/turn/huAssemblyReform";

import { bindHu2011Campaigns } from "./assemblyCampaignBinding2011";
import { huAssemblyElectionSystem } from "./rules/electoralTransition2011";
import { calendarTurn } from "@/lib/utils/gameDate";

/** Hungary National Assembly. */
export async function ensureHUElections(now: Date, inFlightTurn?: number): Promise<void> {
  const db = await getDb();
  const game = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        preset: 1,
        currentTurn: 1,
        huAssemblyReformedAtYear: 1,
        preIteration: 1,
        preIterationTurns: 1,
      },
    }
  );
  const country =
    game?.preset === "1991-default"
      ? await db
          .collection<CountryGameState>("countryGameStates")
          .findOne({ _id: "HU" }, { projection: { huElectoralSystem2011SinceTurn: 1 } })
      : null;
  const turn = inFlightTurn ?? game?.currentTurn ?? 1;
  const modern =
    game?.preset === "1991-default" &&
    huAssemblyElectionSystem({
      calendarTurn: calendarTurn(turn, {
        preIterationActive: game.preIteration?.active,
        preIterationTurns: game.preIterationTurns,
      }),
      authorizedTurn: country?.huElectoralSystem2011SinceTurn,
      legacyModernAssemblyYear: game.huAssemblyReformedAtYear,
    }) === "mixed-2011-v1";
  if (game?.preset === "1991-default") {
    if (Number.isSafeInteger(turn) && turn > 0) await advanceHu1991ListVacancy(db, turn, now);
    // Completed first rounds and their second rounds still belong to the same
    // mandate. Wait for whole-Assembly handover before scheduling a new term.
    const pending = await db.collection<Election>("elections").findOne(
      {
        countryId: "HU",
        electionType: "nationalAssembly",
        cycle: { $gte: 1 },
        status: "completed",
        hungarianModernAssembly: { $exists: false },
      },
      { projection: { _id: 1 } }
    );
    if (pending) {
      await bindHu2011Campaigns(db, game, turn, now);
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
      preserveLiveSeatCounts: game?.preset === "1991-default",
      seatsForRegions: (regions, preset) =>
        preset === "1991-default" &&
        modern &&
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
    await bindHu2011Campaigns(db, game, turn, now);
    await bindHu1991Campaigns(db, now);
    if (
      Number.isSafeInteger(inFlightTurn ?? game.currentTurn) &&
      (inFlightTurn ?? game.currentTurn) > 0
    )
      await openHu1991ByElections(db, inFlightTurn ?? game.currentTurn, now);
  }
}
