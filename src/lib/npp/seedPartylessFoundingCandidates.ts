import { ObjectId, type Db } from "mongodb";
import type { Election, GameState, NPP, State } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryConfigForRuntime } from "@/lib/constants/countries";
import { getEnabledCountryIdsFromDb } from "@/lib/countryAccess";
import { reserveSequentialIds } from "@/lib/db/sequentialId";
import { generateUniqueNPPName } from "./nameGenerator";
import { selectPoliticianImage, weightedRandomEthnicity } from "./generator";
import { NPP_ECONOMY_DEFAULTS } from "./economyDefaults";
import { generateDefaultPersonality } from "./seedHistorical";

/** Marker used only to make this bootstrap-created independent pool idempotent. */
export const PARTYLESS_FOUNDING_PRIOR_MARKER = "foundingIndependent";

export interface PartylessFoundingCandidatesResult {
  nppsCreated: number;
  byCountry: Record<string, number>;
}

/**
 * Seed one independent, unseated NPP for each NPC-enterable cycle-0 race in a
 * player-enabled country. It deliberately writes no party or party-organization
 * rows. Call after the last `clearStartingPolitics` pass: the reset cleanup is
 * designed to remove political NPPs, while this pool is part of the resulting
 * partyless founding world.
 *
 * Nationwide US presidential races are omitted because NPPs are barred from
 * filing there; a player can still enter. One-party states are omitted because
 * the filing rules correctly reject independent candidates there.
 */
export async function seedPartylessFoundingCandidates(
  db: Db,
  preset: string,
  log: (msg: string) => void = () => {}
): Promise<PartylessFoundingCandidatesResult> {
  if (preset !== "1991-default") {
    throw new Error("Partyless founding candidates are supported only for 1991-default");
  }

  const gameState = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { preset: 1, startingPartiesMode: 1, preIteration: 1 } }
    );
  if (
    gameState?.preset !== "1991-default" ||
    gameState.startingPartiesMode !== "none" ||
    gameState.preIteration?.active !== true
  ) {
    throw new Error(
      "Partyless founding candidates require an active 1991-default founding phase with no starting parties"
    );
  }

  const enabled = await getEnabledCountryIdsFromDb(db);
  if (enabled.length === 0) return { nppsCreated: 0, byCountry: {} };
  const enabledSet = new Set(enabled);
  const states = await db
    .collection<State>("states")
    .find({ countryId: { $in: enabled } }, { projection: { _id: 1, countryId: 1 } })
    .toArray();
  const regions = new Set(states.map((state) => `${state.countryId}:${state._id}`));
  const elections = await db
    .collection<Pick<Election, "_id" | "countryId" | "state" | "electionType">>("elections")
    .find({ cycle: 0, countryId: { $in: enabled } })
    .project({ _id: 1, countryId: 1, state: 1, electionType: 1 })
    .toArray();

  const targetByRegion = new Map<string, number>();
  for (const election of elections) {
    const countryId = election.countryId as CountryId | undefined;
    if (!countryId || !enabledSet.has(countryId)) continue;
    if (getCountryConfigForRuntime(countryId, preset).governmentType === "onePartyState") continue;
    if (election.electionType === "president") continue;
    const state = election.state;
    if (!state) continue;
    const isRegion = regions.has(`${countryId}:${state}`);
    const isNationwide = state === countryId;
    if (!isRegion && !isNationwide) continue;
    const key = `${countryId}:${state}`;
    targetByRegion.set(key, (targetByRegion.get(key) ?? 0) + 1);
  }

  if (targetByRegion.size === 0) {
    log("Partyless founding candidate pool: no NPC-enterable cycle-0 races found");
    return { nppsCreated: 0, byCountry: {} };
  }

  const existing = await db
    .collection<NPP>("npps")
    .find({
      countryId: { $in: enabled },
      party: "independent",
      seededForOfficeType: PARTYLESS_FOUNDING_PRIOR_MARKER,
      retiredAt: null,
    })
    .project({ _id: 1, countryId: 1, homeState: 1, name: 1 })
    .toArray();
  const existingCount = new Map<string, number>();
  const names = new Set<string>();
  for (const npp of existing) {
    if (!npp.countryId) continue;
    const key = `${npp.countryId}:${npp.homeState}`;
    existingCount.set(key, (existingCount.get(key) ?? 0) + 1);
    names.add(npp.name);
  }

  const plan: Array<{ countryId: CountryId; state: string }> = [];
  const byCountry: Record<string, number> = {};
  for (const [key, target] of targetByRegion) {
    const separator = key.indexOf(":");
    const countryId = key.slice(0, separator) as CountryId;
    const state = key.slice(separator + 1);
    const missing = Math.max(0, target - (existingCount.get(key) ?? 0));
    for (let index = 0; index < missing; index++) {
      plan.push({ countryId, state });
      byCountry[countryId] = (byCountry[countryId] ?? 0) + 1;
    }
  }

  if (plan.length === 0) {
    log(
      "Partyless founding candidate pool: existing independent priors already cover cycle-0 races"
    );
    return { nppsCreated: 0, byCountry: {} };
  }

  const sequentialIds = await reserveSequentialIds(db, "npp", plan.length);
  const now = new Date();
  const npps: NPP[] = plan.map(({ countryId, state }, index) => {
    let name = generateUniqueNPPName([...names], 100, countryId);
    if (!name) name = `Independent ${countryId} ${sequentialIds[index]}`;
    names.add(name);
    const gender = Math.random() < 0.5 ? "male" : "female";
    const ethnicity = weightedRandomEthnicity(countryId);
    const avatarUrl = selectPoliticianImage(countryId, gender, ethnicity, name);
    return {
      _id: new ObjectId(),
      sequentialId: sequentialIds[index],
      name,
      countryId,
      homeState: state,
      gender,
      ethnicity,
      ...(avatarUrl ? { avatarUrl } : {}),
      politicalInfluence: 10,
      favorability: 50 + Math.random() * 20 - 10,
      policies: { economic: 0, social: 0 },
      party: "independent",
      currentOffice: null,
      seededForOfficeType: PARTYLESS_FOUNDING_PRIOR_MARKER,
      personality: generateDefaultPersonality(),
      generatedAt: now,
      retiredAt: null,
      influenceState: { totalTimesInfluenced: 0 },
      ...NPP_ECONOMY_DEFAULTS,
      archetypeApprovals: {},
      electionCooldowns: {},
      createdAt: now,
      updatedAt: now,
    };
  });

  await db.collection<NPP>("npps").insertMany(npps);
  log(
    `Seeded ${npps.length} independent founding candidate NPPs across ${
      Object.keys(byCountry).length
    } player countries`
  );
  return { nppsCreated: npps.length, byCountry };
}
