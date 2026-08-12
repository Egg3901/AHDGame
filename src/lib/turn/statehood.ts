import type { Db, AnyBulkWriteOperation } from "mongodb";
import type { State } from "@/lib/db/types/state";
import type { GameState } from "@/lib/db/types/gameState";
import type {
  ElectedOfficial,
  PoliticalParty,
  Seat,
  SenateClass,
  StatePartyOrg,
  StateRegistrationPool,
} from "@/lib/db/types";
import { SENATE_CLASSES } from "@/lib/constants";
import { getHouseSeats } from "@/lib/constants/states";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { buildUsStateSeats } from "@/lib/admin/seed/seedSeats";
import { createSystemNewsPost } from "@/lib/news";
import { get1953USRegistrationSeed } from "@/lib/seeds/registration/registrationLanes1953";
import { getStatePartyOrgDocumentId } from "@/lib/db/partyLookup";
import {
  INITIAL_HOUSE_SEATS_ON_ADMISSION,
  TERRITORY_ADMISSIONS,
  buildAdmissionContent,
  decideAdmissions,
  type AdmissionDecision,
} from "@/lib/elections/statehoodAdmission";
import { buildMajorPartyOrgsForState } from "@/lib/seeds/reference/statePartyOrg";

export interface StatehoodResult {
  ran: boolean;
  year?: number;
  admitted?: AdmissionDecision[];
}

/**
 * Evaluate statehood admission at most once per in-game year.
 *
 * The roll is keyed on the year and is idempotent on its own, so this guard is
 * about not repeating the work (and the write) on every turn of the year.
 */
export function shouldEvaluateStatehood(
  currentYear: number,
  lastStatehoodYear: number | undefined
): boolean {
  if (!Number.isFinite(currentYear)) return false;
  return currentYear > (lastStatehoodYear ?? -Infinity);
}

/**
 * Territories that could still be admitted in this world: known to the
 * admission table, absent from the preset's apportionment map (which is what
 * "not a state" means here), and not already admitted earlier in this game.
 */
export function pendingTerritories(preset: string | undefined, alreadyAdmitted: Set<string>) {
  const seats = getHouseSeats(preset);
  return TERRITORY_ADMISSIONS.filter(
    (t) => !(t.stateId in seats) && !alreadyAdmitted.has(t.stateId)
  );
}

/**
 * Statehood admission phase — the transition `runCensus` never had.
 *
 * `runCensus` reapportions among states that ALREADY hold seats, so a territory
 * seeded outside the apportionment map (Alaska and Hawaii under `1953-default`)
 * could never enter it. This rolls each pending territory's era-windowed
 * admission pressure once a year and, on success, writes the state into
 * existence: `admittedYear` (which `loadApportionment` reads) plus the
 * one-seat constitutional floor. The next census then reapportions the full 435
 * across the larger union, exactly as it does for any other seat change.
 *
 * A no-op for every preset from 1979 on, whose maps already carry both.
 */
/**
 * Give a newly admitted state the political furniture every other state got at
 * bootstrap: its seat rows and its vacant offices.
 *
 * Deliberately does NOT create elections. `ensurePerpetualElections` runs every
 * turn and already spawns any missing House / Senate-class / Governor /
 * stateSenate race on the canonical schedule for every state on its roster —
 * so once the state is on that roster (via `admittedYear`), its elections
 * appear through the same path, on the same calendar, as everyone else's.
 * Writing a second scheduling path here would be the risky way to do it.
 *
 * Idempotent: seats upsert by their deterministic `_id`, and officials are only
 * created for a state that has none.
 */
export async function seedAdmittedStatePolitics(
  db: Db,
  admitted: AdmissionDecision[],
  now: Date,
  preset?: string
): Promise<void> {
  for (const decision of admitted) {
    const stateId = decision.stateId;

    const seats = buildUsStateSeats(stateId, INITIAL_HOUSE_SEATS_ON_ADMISSION, now);
    await db.collection<Seat>("seats").bulkWrite(
      seats.map((seat) => {
        const { _id, ...body } = seat;
        return {
          updateOne: {
            filter: { _id },
            update: { $set: body },
            upsert: true,
          },
        };
      }),
      { ordered: false }
    );

    // Create the canonical major-party chapters skipped while this was a
    // territory. The 1953 registration overlay below then applies the more
    // detailed historical organization and registration shares.
    const orgRows = buildMajorPartyOrgsForState(stateId, preset ?? DEFAULT_SEED_PRESET);
    if (orgRows.length > 0) {
      await db.collection<StatePartyOrg>("statePartyOrg").bulkWrite(
        orgRows.map((org) => {
          const { _id, ...body } = org;
          return {
            updateOne: {
              filter: { _id },
              update: {
                $set: { ...body, updatedAt: now },
                $setOnInsert: { createdAt: now },
              },
              upsert: true,
            },
          };
        }),
        { ordered: false }
      );
    }

    const registrationSeed = get1953USRegistrationSeed(stateId);
    if (!registrationSeed) {
      throw new Error(`Statehood seed is missing 1953 registration data for ${stateId}`);
    }
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({
        countryId: "US",
        abbreviation: { $in: registrationSeed.parties.map((party) => party.abbr) },
      })
      .toArray();
    const partyByAbbr = new Map(
      parties.map((party) => [party.abbreviation.toUpperCase(), party] as const)
    );
    for (const share of registrationSeed.parties) {
      const party = partyByAbbr.get(share.abbr);
      if (!party) {
        throw new Error(`Statehood seed cannot find US party ${share.abbr} for ${stateId}`);
      }
      // Orgs were upserted above via buildMajorPartyOrgsForState. Do not call
      // ensureStatePartyOrgRow here — its political gate re-reads admittedYear
      // and can race the bulkWrite that just stamped it (and mock DBs never
      // surface that write). Update the row we already created.
      const orgId = getStatePartyOrgDocumentId(stateId, party);
      // statePartyOrg is keyed by a composite STRING id, not an ObjectId.
      await db.collection<{ _id: string }>("statePartyOrg").updateOne(
        { _id: orgId },
        {
          $set: {
            organization: share.org,
            registration: share.reg,
            hasPresence: true,
            updatedAt: now,
          },
        }
      );
    }
    await db.collection<StateRegistrationPool>("stateRegistrationPool").updateOne(
      { _id: `US_${stateId}` },
      {
        $set: {
          countryId: "US",
          stateId,
          independent: registrationSeed.independent,
          unregistered: registrationSeed.unregistered,
          lastUpdatedTurn: 0,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    // A territory has no officials. Skip if any exist so a re-run (or an
    // admin-seeded delegation) is never duplicated.
    const existingOfficials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .countDocuments({ state: stateId, officeType: { $in: ["senate", "house"] } });
    if (existingOfficials > 0) continue;

    const officials: Omit<ElectedOfficial, "_id">[] = [];
    for (const cls of (SENATE_CLASSES[stateId] ?? [1, 2]) as SenateClass[]) {
      officials.push({
        officeType: "senate",
        state: stateId,
        isAppointment: false,
        senateClass: cls,
        characterId: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (let district = 1; district <= INITIAL_HOUSE_SEATS_ON_ADMISSION; district++) {
      officials.push({
        officeType: "house",
        state: stateId,
        isAppointment: false,
        district,
        characterId: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    await db
      .collection<ElectedOfficial>("electedOfficials")
      .insertMany(officials as ElectedOfficial[]);
  }
}

export async function runStatehoodAdmission(db: Db, _turn: number): Promise<StatehoodResult> {
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" } as Partial<GameState>);
  const currentYear = gameState?.currentYear;
  if (
    currentYear === undefined ||
    !shouldEvaluateStatehood(currentYear, gameState?.lastStatehoodYear)
  ) {
    return { ran: false };
  }

  const preset = gameState?.preset;
  const candidateIds = TERRITORY_ADMISSIONS.map((t) => t.stateId);
  const existing = (await db
    .collection<State>("states")
    .find({ _id: { $in: candidateIds } }, { projection: { _id: 1, admittedYear: 1 } })
    .toArray()) as unknown as Array<{ _id: string; admittedYear?: number }>;
  const alreadyAdmitted = new Set(
    existing.filter((s) => typeof s.admittedYear === "number").map((s) => s._id)
  );

  const pending = pendingTerritories(preset, alreadyAdmitted);
  if (pending.length === 0) {
    // Nothing can ever be admitted in this world — stamp the year so the query
    // above does not run again until the calendar moves.
    await db
      .collection<GameState>("gameState")
      .updateOne({ _id: "current" } as Partial<GameState>, {
        $set: { lastStatehoodYear: currentYear },
      });
    return { ran: true, year: currentYear, admitted: [] };
  }

  // Different worlds must diverge, so the roll is keyed on the iteration. A
  // world with no iteration stamp still needs a stable key.
  const iteration = gameState?.iteration
    ? `${gameState.iteration.type}-${gameState.iteration.number}`
    : "default";

  const admitted = decideAdmissions(pending, currentYear, iteration);

  if (admitted.length > 0) {
    const ops: AnyBulkWriteOperation<State>[] = admitted.map((d) => ({
      updateOne: {
        filter: { _id: d.stateId },
        update: {
          $set: {
            admittedYear: d.year,
            houseDistricts: INITIAL_HOUSE_SEATS_ON_ADMISSION,
          },
        },
      },
    }));
    await db.collection<State>("states").bulkWrite(ops);
    await seedAdmittedStatePolitics(db, admitted, new Date(), preset);
  }

  await db.collection<GameState>("gameState").updateOne({ _id: "current" } as Partial<GameState>, {
    $set: { lastStatehoodYear: currentYear },
  });

  if (admitted.length > 0) {
    await createSystemNewsPost(buildAdmissionContent(admitted), "election", {
      title: `${admitted.map((d) => d.name).join(" and ")} Admitted to the Union`,
    });
  }

  return { ran: true, year: currentYear, admitted };
}
