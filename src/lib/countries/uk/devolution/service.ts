/**
 * UK devolution reads the enacted national settlement and preserves founding
 * election anchors. Abolition vacates regional executives and cancels their
 * unfinished races without deleting historical election records.
 */
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import type { Db, Filter } from "mongodb";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import type { GameState } from "@/lib/db/types/gameState";
import type { Election, ElectedOfficial, StatePolicy } from "@/lib/db/types";
import { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";
import {
  applyUKDevolutionPolicy,
  initialUKDevolutionState,
  UK_EXECUTIVE_REGIONS,
  type UKDevolutionState,
  type UKExecutiveRegion,
} from "./rules";

export async function readUKDevolutionState(
  db: Db,
  startingYear: number
): Promise<UKDevolutionState> {
  const stored = await db.collection<UKDevolutionState>("ukDevolution").findOne({ _id: "UK" });
  if (stored) return stored;
  return initialStatePreservingLeaders(db, startingYear);
}

async function initialStatePreservingLeaders(
  db: Db,
  startingYear: number
): Promise<UKDevolutionState> {
  const state = initialUKDevolutionState(startingYear);
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { countryId: "UK", officeType: "governor", state: { $in: [...UK_EXECUTIVE_REGIONS] } },
      { projection: { state: 1, characterId: 1, nppId: 1, _id: 0 } }
    )
    .toArray();
  for (const official of officials) {
    const region = official.state as UKExecutiveRegion;
    if (UK_EXECUTIVE_REGIONS.includes(region) && (official.characterId || official.nppId)) {
      state.regions[region].active = true;
    }
  }
  return state;
}

export async function reconcileUKDevolution(
  db: Db,
  startingYear: number,
  completedElections: ReadonlyArray<Pick<Election, "state" | "cycle">>,
  now: Date
): Promise<UKDevolutionState> {
  const [stored, policy] = await Promise.all([
    db.collection<UKDevolutionState>("ukDevolution").findOne({ _id: "UK" }),
    db
      .collection<StatePolicy>("statePolicies")
      .findOne(
        { stateId: "uk_national", legislationTypeId: "uk_devolution_local_powers" },
        { projection: { policyOptionIndex: 1, enactedTurn: 1, enactedByBillId: 1, enactedBy: 1 } }
      ),
  ]);
  const state = stored ?? (await initialStatePreservingLeaders(db, startingYear));
  const latestCycles: Partial<Record<UKExecutiveRegion, number>> = {};
  for (const election of completedElections) {
    const region = election.state as UKExecutiveRegion;
    if (UK_EXECUTIVE_REGIONS.includes(region)) {
      latestCycles[region] = Math.max(latestCycles[region] ?? 0, election.cycle);
    }
  }
  const billId = policy?.enactedBy?.kind === "bill" ? policy.enactedBy.id : policy?.enactedByBillId;
  const enacted =
    billId && policy && (policy.enactedBy == null || policy.enactedBy.kind === "bill")
      ? {
          billId: String(billId),
          optionIndex: policy.policyOptionIndex,
          enactedTurn: policy.enactedTurn,
        }
      : null;
  const next = applyUKDevolutionPolicy(
    state,
    enacted,
    latestCycles,
    24 + DEFAULT_DURATIONS.governor.generalDurationHours
  );
  if (stored && next === state) return state;

  const inactive = UK_EXECUTIVE_REGIONS.filter((region) => !next.regions[region].active);
  await vacateUKRegionalExecutives(db, inactive, now);

  await db
    .collection<UKDevolutionState>("ukDevolution")
    .updateOne({ _id: "UK" }, { $set: next }, { upsert: true });
  return next;
}

/** Reconcile immediately after enactment, using the same rules as the turn. */
export async function reconcileEnactedUKDevolution(db: Db, now: Date): Promise<void> {
  const [gameState, completed] = await Promise.all([
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { startingYear: 1, preset: 1 } }),
    db
      .collection<Election>("elections")
      .find(
        { countryId: "UK", electionType: "governor", status: { $in: ["completed", "resolved"] } },
        { projection: { state: 1, cycle: 1, _id: 0 } }
      )
      .toArray(),
  ]);
  await reconcileUKDevolution(
    db,
    gameState?.startingYear ?? getStartingYearForPreset(gameState?.preset ?? DEFAULT_SEED_PRESET),
    completed,
    now
  );
}

export async function isUKRegionalExecutiveActive(db: Db, stateId: string): Promise<boolean> {
  if (!UK_EXECUTIVE_REGIONS.includes(stateId as UKExecutiveRegion)) return false;
  const stored = await db.collection<UKDevolutionState>("ukDevolution").findOne({ _id: "UK" });
  if (stored) return stored.regions[stateId as UKExecutiveRegion].active;
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { startingYear: 1, preset: 1 } });
  const initial = await initialStatePreservingLeaders(
    db,
    gameState?.startingYear ?? getStartingYearForPreset(gameState?.preset ?? DEFAULT_SEED_PRESET)
  );
  return initial.regions[stateId as UKExecutiveRegion].active;
}

/** Withdraw authority without deleting election history; also used by peace suspension. */
export async function vacateUKRegionalExecutives(
  db: Db,
  inactive: readonly UKExecutiveRegion[],
  now: Date
): Promise<void> {
  if (inactive.length > 0) {
    const filter: Filter<ElectedOfficial> = {
      countryId: "UK",
      officeType: "governor",
      state: { $in: [...inactive] },
    };
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find(filter, {
        projection: { characterId: 1, nppId: 1, _id: 0 },
      })
      .toArray();
    const characters = officials.flatMap((official) =>
      official.characterId ? [official.characterId] : []
    );
    const npps = officials.flatMap((official) => (official.nppId ? [official.nppId] : []));
    await db.collection("elections").updateMany(
      {
        countryId: "UK",
        electionType: "governor",
        state: { $in: [...inactive] },
        status: { $in: ["active", "upcoming"] },
      },
      { $set: { status: "cancelled", updatedAt: now } }
    );
    if (characters.length)
      await db
        .collection("characters")
        .updateMany(
          { _id: { $in: characters }, currentOffice: "governor" },
          { $set: { currentOffice: null, updatedAt: now } }
        );
    if (npps.length)
      await db
        .collection("npps")
        .updateMany(
          { _id: { $in: npps }, currentOffice: "governor" },
          { $set: { currentOffice: null, updatedAt: now } }
        );
    await db.collection<ElectedOfficial>("electedOfficials").updateMany(filter, {
      $set: {
        characterId: null,
        nppId: null,
        isNPP: false,
        updatedAt: now,
      },
      $unset: { characterName: "", party: "" },
    });
    await db.collection("governorOfficeState").updateMany(
      { countryId: "UK", stateId: { $in: [...inactive] } },
      {
        $set: { characterId: null, characterName: "", gubernatorialActions: 0, updatedAt: now },
        $unset: { devolutionPolicy: "" },
      }
    );
  }
}
