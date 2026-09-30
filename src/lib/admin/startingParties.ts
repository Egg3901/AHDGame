/**
 * No starting parties leaves player countries open to player-created parties.
 * Background governments remain seeded. Cleanup removes player-country politicians, retaining
 * economic owners and the historical institutions: see clearStartingPolitics.
 */
import { ObjectId, type Db, type Filter, type Document } from "mongodb";
import type { Bond, CentralBank, Corporation, GameState, NPP } from "@/lib/db/types";
import { COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { getEnabledCountryIdsFromDb } from "@/lib/countryAccess";
import { invalidateCachedCountryState } from "@/lib/countryState/cache";
import { getCountryStateCollection } from "@/lib/db/collections/countryState";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import type { StateRegistrationPool } from "@/lib/db/types/stateRegistrationPool";

export type StartingPartiesMode = "default" | "none";

/** No preset alias: the historical economy, institutions and clock stay in 1991. */
export function resolveStartingPartiesMode(
  preset: string,
  mode: StartingPartiesMode = "default"
): StartingPartiesMode {
  if (mode !== "default" && mode !== "none") throw new Error("Invalid starting parties mode");
  if (preset === "2019-no-parties") return "none";
  if (mode === "none" && preset !== "1991-default") {
    throw new Error("No starting parties is supported only for 1991-default");
  }
  return mode;
}

/** Seeded political artifacts. Elections and vacant seat definitions remain playable. */
export const STARTING_POLITICAL_COLLECTIONS = [
  "politicalParties",
  "partyCharters",
  "statePartyOrg",
  "partyBudget",
  "partyMembers",
  "electionCandidates",
  "statePartyCandidates",
  "nationalPartyCandidates",
  "nationalCommitteeCandidates",
  "nationalCommitteeElections",
  "nationalCommitteeVotes",
  "statePartyElections",
  "statePartyVotes",
  "nationalPartyElections",
  "nationalPartyVotes",
  "nationalPartyLeadership",
  "ukPartyLeadership",
  "governmentFormations",
  "governmentFormationVotes",
  "cabinetMembers",
  "cabinetNominations",
  "unifiedCabinetMembers",
  "caucusChairCandidates",
  "slateCandidates",
  "recruitmentSlates",
  "coalitions",
  "caucuses",
  "caucusMemberships",
  "nppRelationships",
  "nppEndorsements",
  "nppVoteCommitments",
  "nppVotePredictions",
] as const;

export const STARTING_POLITICAL_OFFICIAL_FILTER = {
  $or: [
    { nppId: { $exists: true, $ne: null } },
    { characterId: { $exists: true, $ne: null } },
    { isNPP: true },
    { party: { $exists: true, $nin: [null, "", "independent"] } },
  ],
};

/** null preserves the existing globally empty 2019 special preset. */
export async function startingPoliticalCountries(
  db: Db,
  preset: string
): Promise<CountryId[] | null> {
  return preset === "2019-no-parties" ? null : getEnabledCountryIdsFromDb(db);
}

/** Only original US-only callers opt into country-less legacy rows. */
export function startingCountryFilter(
  countries: readonly CountryId[] | null,
  legacyUS = false
): Filter<Document> {
  if (countries === null) return {};
  return legacyUS && countries.includes("US")
    ? { $or: [{ countryId: { $in: [...countries] } }, { countryId: { $exists: false } }] }
    : { countryId: { $in: [...countries] } };
}

const NPP_LINKED_COLLECTIONS = new Set([
  "nppRelationships",
  "nppEndorsements",
  "nppVoteCommitments",
  "nppVotePredictions",
]);

/** Bind country-less child rows to their actual parent before any parent is deleted. */
export async function startingArtifactFilters(
  db: Db,
  countries: readonly CountryId[] | null,
  nppIds: readonly ObjectId[]
): Promise<Record<string, Filter<Document>>> {
  const filters: Record<string, Filter<Document>> = {};
  for (const collection of STARTING_POLITICAL_COLLECTIONS) {
    filters[collection] =
      countries === null
        ? {}
        : NPP_LINKED_COLLECTIONS.has(collection)
          ? { nppId: { $in: [...nppIds] } }
          : startingCountryFilter(countries);
  }
  if (countries === null) return filters;
  const links: Array<{ parent: string; field: string; children: string[]; legacyUS?: boolean }> = [
    { parent: "elections", field: "electionId", children: ["electionCandidates"], legacyUS: true },
    {
      parent: "statePartyElections",
      field: "electionId",
      children: ["statePartyCandidates", "statePartyVotes"],
      legacyUS: true,
    },
    {
      parent: "nationalPartyElections",
      field: "electionId",
      children: ["nationalPartyCandidates", "nationalPartyVotes"],
    },
    {
      parent: "nationalCommitteeElections",
      field: "electionId",
      children: ["nationalCommitteeCandidates", "nationalCommitteeVotes"],
    },
    {
      parent: "caucuses",
      field: "caucusId",
      children: ["caucusMemberships", "caucusChairCandidates"],
    },
    { parent: "recruitmentSlates", field: "slateId", children: ["slateCandidates"] },
  ];
  for (const link of links) {
    const parents = await db
      .collection(link.parent)
      .find(startingCountryFilter(countries, link.legacyUS))
      .project({ _id: 1 })
      .toArray();
    for (const child of link.children) {
      filters[child] = {
        $or: [filters[child], { [link.field]: { $in: parents.map((row) => row._id) } }],
      };
    }
  }
  return filters;
}

/**
 * Reset-only cleanup, never a turn policy. Economic owners survive as independents;
 * players can create parties and enter the ordinary election lifecycle afterwards.
 */
export async function clearStartingPolitics(db: Db, preset: string): Promise<void> {
  const countries = await startingPoliticalCountries(db, preset);
  const countryFilter = startingCountryFilter(countries, true);
  const targetNpps = await db
    .collection<NPP>("npps")
    .find(countryFilter)
    .project<Pick<NPP, "_id">>({ _id: 1 })
    .toArray();
  const targetIds = targetNpps.map((row) => row._id);
  const artifactFilters = await startingArtifactFilters(db, countries, targetIds);
  const owners = new Map<string, ObjectId>();
  const keep = (id: unknown) => {
    if (id instanceof ObjectId) owners.set(id.toHexString(), id);
  };
  const corporations = await db
    .collection<Corporation>("corporations")
    .find({})
    .project<Pick<Corporation, "ceoId" | "ceoType" | "shareholders">>({
      ceoId: 1,
      ceoType: 1,
      shareholders: 1,
    })
    .toArray();
  for (const corporation of corporations) {
    if (corporation.ceoType === "npp") keep(corporation.ceoId);
    for (const holder of corporation.shareholders ?? []) keep(holder.nppId);
  }
  const bonds = await db
    .collection<Bond>("bonds")
    .find({})
    .project<Pick<Bond, "holders">>({ holders: 1 })
    .toArray();
  for (const bond of bonds) for (const holder of bond.holders ?? []) keep(holder.nppId);
  const banks = await db
    .collection<CentralBank>("centralBanks")
    .find({})
    .project<Pick<CentralBank, "chairNppId" | "fomcBoard">>({ chairNppId: 1, fomcBoard: 1 })
    .toArray();
  for (const bank of banks) {
    keep(bank.chairNppId);
    for (const seat of bank.fomcBoard ?? []) keep(seat.nppId);
  }
  for (const collection of ["indexFundPositions", "indexFundRedemptionQueue"]) {
    const positions = await db
      .collection(collection)
      .find({ nppId: { $exists: true } })
      .project({ nppId: 1 })
      .toArray();
    for (const position of positions) keep(position.nppId);
  }
  const accounts = await db
    .collection<SavingsAccount>("savingsAccounts")
    .find({ ownerType: "npp" })
    .project<Pick<SavingsAccount, "ownerId">>({ ownerId: 1 })
    .toArray();
  for (const account of accounts) keep(account.ownerId);
  // Keep outstanding credit liabilities, but not unreferenced seeded politician wallets.
  // The no-party baseline is captured after cleanup, not during intermediate seeding.
  const borrowers = await db
    .collection<NPP>("npps")
    .find({})
    .project<Pick<NPP, "_id" | "lineOfCredit">>({ lineOfCredit: 1 })
    .toArray();
  for (const borrower of borrowers) {
    const amounts = [
      ...Object.values(borrower.lineOfCredit?.balances ?? {}),
      ...Object.values(borrower.lineOfCredit?.arrears ?? {}),
    ];
    if (amounts.some((amount) => typeof amount === "number" && amount !== 0)) keep(borrower._id);
  }
  const retained = [...owners.values()];
  await db.collection<NPP>("npps").deleteMany({ _id: { $in: targetIds, $nin: retained } });
  await db.collection<NPP>("npps").updateMany(
    { _id: { $in: targetIds } },
    {
      $set: { party: "independent", currentOffice: null },
      $unset: { seededForOfficeType: "" },
    }
  );
  for (const collection of STARTING_POLITICAL_COLLECTIONS) {
    await db.collection(collection).deleteMany(artifactFilters[collection]);
  }
  await db
    .collection("electedOfficials")
    .deleteMany({ $and: [countryFilter, STARTING_POLITICAL_OFFICIAL_FILTER] });
  await getCountryStateCollection(db).updateMany(
    countries === null ? {} : { _id: { $in: countries } },
    { $set: { rulingPartyId: null } }
  );
  for (const countryId of countries ?? COUNTRY_ORDER) invalidateCachedCountryState(db, countryId);
  await db.collection("governorOfficeState").updateMany(countryFilter, {
    $set: { characterId: null, characterName: "Vacant" },
  });
  // Party registrants become unattached voters; engagement is not changed.
  const pools = await db
    .collection<StateRegistrationPool>("stateRegistrationPool")
    .find(countryFilter)
    .project<Pick<StateRegistrationPool, "_id" | "unregistered">>({ unregistered: 1 })
    .toArray();
  if (pools.length > 0) {
    await db.collection<StateRegistrationPool>("stateRegistrationPool").bulkWrite(
      pools.map((pool) => ({
        updateOne: {
          filter: { _id: pool._id },
          update: { $set: { independent: 100 - pool.unregistered } },
        },
      }))
    );
  }
}

/** Reseeding/finalizing an existing empty start must not silently restore parties. */
export async function loadStartingPartiesMode(
  db: Db,
  preset: string,
  explicit?: StartingPartiesMode
): Promise<StartingPartiesMode> {
  if (explicit !== undefined) return resolveStartingPartiesMode(preset, explicit);
  const state = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1, startingPartiesMode: 1 } });
  return resolveStartingPartiesMode(
    preset,
    state?.preset === preset ? state.startingPartiesMode : "default"
  );
}
