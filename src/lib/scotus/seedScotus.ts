import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { SupremeCourtSeat, DocketCase } from "@/lib/db/types/scotus";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { getScotusPresetSeed } from "./presetData";

/**
 * Seed nine vacant SCOTUS seats plus the era docket for the US, as part of
 * era-preset world creation/reset (#3598 scope item 8). Wired into
 * `bootstrapGameWorld.ts` alongside the other US-only, preset-gated seed steps
 * (mirrors `seedPoliticalLegislationBaseline`'s placement/shape).
 *
 * No-ops (logs and returns) when the preset's roster/docket content hasn't
 * been authored yet — see `src/lib/scotus/presetData/index.ts` — so this hook
 * is safe to ship ahead of the four content tickets (#3599-#3602).
 *
 * Historical people are deliberately not seated or copied into the game
 * database. Every court starts vacant and must be filled through the ordinary
 * player/NPP nomination flow. The preset docket remains historical context,
 * but no real officeholder is impersonated as a playable game entity.
 *
 * A world that never fills the court stays safe: `decideCaseOutcome` affirms
 * every case on an empty bench, so the docket plays out as pure history until
 * a live presidency starts confirming justices.
 *
 * On `reset=true`, wipes `supremeCourtSeats`/`docketCases`/`scotusNominations`
 * for the country first so a world reset never retains a stale prior court.
 */
export async function seedScotus(
  db: Db,
  log: (msg: string) => void,
  preset: string,
  reset = false
): Promise<{ seatsSeeded: number; casesSeeded: number }> {
  const countryId = "US" as const;

  if (reset) {
    await Promise.all([
      db.collection("supremeCourtSeats").deleteMany({ countryId }),
      db.collection("docketCases").deleteMany({ countryId }),
      db.collection("scotusNominations").deleteMany({ countryId }),
    ]);
  }

  const data = getScotusPresetSeed(preset);
  if (!data || data.seats.length === 0) {
    log(`[scotus] No roster/docket content authored yet for preset "${preset}" — skipping.`);
    return { seatsSeeded: 0, casesSeeded: 0 };
  }

  const now = new Date();
  const startingYear = getStartingYearForPreset(preset);

  // Upgrade safety for worlds created before historical identity seeding was
  // removed. Preserve any player or fictional NPP justice currently seated,
  // but erase the stored real-person succession chain from every seat. A
  // currently scripted historical occupant becomes a vacancy that the normal
  // nomination flow can fill.
  //
  // Deliberately NOT gated on `reset`: purging real-person identities from
  // live worlds is the point of the migration (settled product decision), and
  // on reset=true these collections were just deleted so both updates match
  // nothing. It runs on any admin re-seed of a live world, so it logs loudly
  // below whenever it actually vacated something.
  const chainWipe = await db.collection<SupremeCourtSeat>("supremeCourtSeats").updateMany(
    { countryId, "historicalOccupants.0": { $exists: true } },
    {
      $set: {
        historicalOccupants: [],
        historicalOccupantIndex: -1,
        isDivergent: true,
        updatedAt: now,
      },
    }
  );
  const occupantWipe = await db.collection<SupremeCourtSeat>("supremeCourtSeats").updateMany(
    { countryId, justiceMode: "historical" },
    {
      $set: {
        justiceMode: null,
        justiceCharacterId: null,
        justiceNppId: null,
        justiceName: null,
        justiceParty: null,
        economicLean: null,
        socialLean: null,
        seatedAt: null,
        seatedAtTurn: null,
        historicalOccupants: [],
        historicalOccupantIndex: -1,
        isDivergent: true,
        updatedAt: now,
      },
    }
  );
  if (chainWipe.modifiedCount > 0 || occupantWipe.modifiedCount > 0) {
    log(
      `[scotus] MIGRATION: erased historical succession chains from ${chainWipe.modifiedCount} ` +
        `seat(s) and vacated ${occupantWipe.modifiedCount} scripted historical occupant(s) on a ` +
        `live world. Player/NPP justices were preserved; vacancies refill via nomination.`
    );
  }

  let seatsSeeded = 0;
  for (const seatSeed of data.seats) {
    const seat: Omit<SupremeCourtSeat, "_id"> = {
      countryId,
      seatNumber: seatSeed.seatNumber,
      justiceMode: null,
      justiceCharacterId: null,
      justiceNppId: null,
      justiceName: null,
      justiceParty: null,
      economicLean: null,
      socialLean: null,
      seatedAt: null,
      seatedAtTurn: null,
      // A freshly seeded vacant seat has diverged from nothing - there is no
      // authored succession script to depart from. The Divergence Point is a
      // live confirmation (scotusNominationLifecycle sets isDivergent there),
      // and the UI's divergence badge keys off this flag. The tenure turn's
      // non-divergent branch no-ops on an empty historicalOccupants array.
      isDivergent: false,
      historicalOccupantIndex: -1,
      historicalOccupants: [],
      divergentHazardStartsTurn: null,
      createdAt: now,
      updatedAt: now,
    };
    await db
      .collection<SupremeCourtSeat>("supremeCourtSeats")
      .updateOne(
        { countryId, seatNumber: seatSeed.seatNumber },
        { $setOnInsert: { _id: new ObjectId(), ...seat } as SupremeCourtSeat },
        { upsert: true }
      );
    seatsSeeded++;
  }

  let casesSeeded = 0;
  for (const caseSeed of data.docket) {
    const docketCase: Omit<DocketCase, "_id"> = {
      countryId,
      preset,
      caseKey: caseSeed.caseKey,
      title: caseSeed.title,
      axis: caseSeed.axis,
      historicalMajorityDirection: caseSeed.historicalMajorityDirection,
      decisionYear: caseSeed.decisionYear,
      historicalOutcomeLocked: caseSeed.historicalOutcomeLocked,
      effect: caseSeed.effect,
      historicalSummary: caseSeed.historicalSummary,
      alternateSummary: caseSeed.alternateSummary,
      demographicSignal: caseSeed.demographicSignal,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    await db
      .collection<DocketCase>("docketCases")
      .updateOne(
        { countryId, preset, caseKey: caseSeed.caseKey },
        { $setOnInsert: { _id: new ObjectId(), ...docketCase } as DocketCase },
        { upsert: true }
      );
    casesSeeded++;
  }

  log(
    `[scotus] Seeded ${seatsSeeded} vacant seat(s) + ${casesSeeded} docket case(s) for preset "${preset}" (starting year ${startingYear}).`
  );
  return { seatsSeeded, casesSeeded };
}
