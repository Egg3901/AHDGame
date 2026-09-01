/**
 * What a resolved German Question actually does to the world.
 *
 * `incumbent` — West Germany stays sovereign in NATO. Nothing is absorbed and
 * no border moves; the crisis closes, both Germanies get a history entry, and a
 * cooldown runs before the question can be asked again.
 *
 * `challenger` — the two Germanies become one, in the Warsaw Pact, under a
 * one-party constitutional settlement.
 *
 * WHICH SHELL SURVIVES, AND WHY IT IS DE.
 *
 * The design called for the winner's shell to survive, which would mean the GDR
 * absorbing the Federal Republic. That is not buildable and the reason is not
 * effort — a country's NAME is seed data (`countryState` calls it immutable,
 * `COUNTRY_CONFIGS.DD.name` is compiled in and read at ~90 synchronous call
 * sites, many of them client components). A unified Germany that renders as
 * "East Germany" everywhere is not the outcome the design describes.
 *
 * DE survives instead, and the outcome supplies the CHARACTER rather than the
 * shell: DE is already named "Germany", `governmentType` genuinely is runtime
 * state (`countryState`, which is how post-conversion head-of-government
 * resolution already works), and bloc membership is a document. So a unified
 * socialist Germany in the Warsaw Pact is expressible today, while a renamed
 * GDR is not.
 *
 * What a player sees is identical: one country called Germany, one-party, in
 * the Pact, holding every Land. Only the surviving document id differs — and
 * DD, not DE, is the one with players to carry across, which `mergeCountry`
 * does by bringing residents over with their regions.
 */
import type { Db, ObjectId } from "mongodb";
import type { SettlementCrisisDoc, SettlementOutcome } from "@/lib/db/types/settlementCrisis";
import type { CountryId } from "@/lib/constants/countries";
import {
  SETTLEMENT_REOPEN_COOLDOWN_TURNS,
  ACTUATION_LEASE_MS,
  GERMAN_QUESTION_BERLIN,
  GERMAN_QUESTION_EAST_BERLIN,
} from "@/lib/constants/settlementCrisis";
import { mergePartiesIntoCountry } from "@/lib/country/mergePartiesIntoCountry";
import { mergeRegion } from "@/lib/country/mergeRegion";
import { mergeNationalFisc } from "@/lib/country/mergeNationalFisc";
import { mergeMilitary } from "@/lib/country/mergeMilitary";
import { mergeEconomicRegime } from "@/lib/country/mergeEconomicRegime";
import { rescopeLegislationCatalogue } from "@/lib/country/rescopeLegislationCatalogue";
import { installOnePartyState } from "@/lib/onePartyState/installOnePartyState";
import { remapOffice } from "@/lib/country/dissolvingOfficeRemap";
import { remapCabinetPosition } from "@/lib/country/dissolvingCabinetRemap";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { mergeCountry } from "@/lib/country/mergeCountry";
import { getCountryState } from "@/lib/countryState";
import { getExecutiveOfficeKey } from "@/lib/constants/countries";
import { carryLeaderStateOnMerge } from "@/lib/turn/rulingPartyConfidence";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import type { GameState } from "@/lib/db/types/gameState";
import type { CountryGameState } from "@/lib/db/types/gameState";
import { yearOfTurn } from "@/lib/utils/gameDate";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import { blocOrgFor } from "@/lib/world/blocMembership";
import { admitMember } from "@/lib/internationalOrganizations/joinApplication";
import { isMember } from "@/lib/internationalOrganizations/service";
import { removeOrganizationMembership } from "@/lib/internationalOrganizations/withdrawalBills";
import {
  INTERNATIONAL_ORGANIZATIONS,
  type InternationalOrganizationId,
} from "@/lib/constants/internationalOrganizations";

export interface ActuationResult {
  actuated: boolean;
  outcome: SettlementOutcome | null;
  /** True when the outcome is recorded but the world change did not complete. */
  deferred: boolean;
  error?: string;
}

const NONE: ActuationResult = { actuated: false, outcome: null, deferred: false };

export async function actuateSettlementOutcome(
  db: Db,
  crisis: SettlementCrisisDoc,
  currentTurn: number
): Promise<ActuationResult> {
  if (crisis.status !== "resolved" || !crisis.outcome) return NONE;
  // Idempotent on COMPLETION, not on the claim. A crisis whose consequences have
  // fully landed must not have its history entries written twice; one that was
  // claimed and then died halfway must be re-entered, not abandoned.
  if (crisis.actuationCompletedTurn != null) return NONE;

  const crises = await getSettlementCrisesCollection(db);
  const now = new Date();
  // A LEASE, not a permanent stamp. Two turn runners must not enter the merge at
  // once, but a lease that never expires is exactly how a killed attempt wedges
  // the crisis for ever — which is what happened to a live reunification. An
  // attempt older than the window is presumed dead and reclaimed.
  const staleBefore = new Date(now.getTime() - ACTUATION_LEASE_MS);
  const claimed = await crises.updateOne(
    {
      _id: crisis._id,
      actuationCompletedTurn: null,
      $or: [
        { actuationClaimedAt: null },
        { actuationClaimedAt: { $exists: false } },
        { actuationClaimedAt: { $lte: staleBefore } },
      ],
    } as Parameters<typeof crises.updateOne>[0],
    { $set: { actuationClaimedAt: now, updatedAt: now } }
  );
  if (claimed.matchedCount !== 1) return NONE;

  /**
   * Mark the settlement enacted and open the reopen cooldown.
   *
   * BOTH at the END, together. The cooldown is a consequence of a settlement that
   * happened, so writing it up front — as this once did — states an outcome the
   * world has not been given yet, and hides a half-done merge from every sweep
   * that would otherwise finish it.
   */
  const finish = async (): Promise<void> => {
    await crises.updateOne(
      { _id: crisis._id },
      {
        $set: {
          actuationCompletedTurn: currentTurn,
          actuationClaimedAt: null,
          cooldownUntilTurn: currentTurn + SETTLEMENT_REOPEN_COOLDOWN_TURNS,
          updatedAt: new Date(),
        },
      }
    );
  };

  /**
   * Give the claim back so the next tick resumes from where this attempt stopped.
   *
   * The steps below are individually idempotent — regions skip when already
   * transferred, the party migration rebuilds its map from the `mergedFrom`
   * stamps, the fisc block is gated on `mergedInto` — so re-entry continues the
   * merge rather than repeating it.
   */
  const release = async (error: string): Promise<ActuationResult> => {
    await crises.updateOne(
      { _id: crisis._id },
      { $set: { actuationClaimedAt: null, updatedAt: new Date() } }
    );
    return { actuated: false, outcome: crisis.outcome, deferred: true, error };
  };

  const target = crisis.targetEntityId as CountryId;
  const challenger = crisis.challengerEntityId as CountryId;

  if (crisis.outcome === "incumbent") {
    const title = "The German Question closed: the Federal Republic stays sovereign in NATO.";
    for (const countryId of [target, challenger]) {
      await recordCountryEvent(db, {
        countryId,
        turn: currentTurn,
        eventType: "international_relations",
        title,
        details: { crisis: crisis.kind, outcome: crisis.outcome },
      });
    }
    await finish();
    return { actuated: true, outcome: "incumbent", deferred: false };
  }

  // challenger — the merge. `target` (DE) is the surviving shell; `challenger`
  // (DD) is absorbed into it. See the header for why that direction.
  //
  // ORDER IS LOAD-BEARING at every step, and each is argued at its own call site.
  //
  //   1. the absorbed ruling party is READ, before anything renumbers it
  //   2. the parties MOVE, before anything reads a party id
  //   3. the country MERGES, carrying regions and officials
  //   4. East Berlin FUSES into Berlin, once both are German
  //   5. the settlement is ADOPTED, once the chamber it reads exists

  // 1. Read first. `mergePartiesIntoCountry` renumbers this value, and the map it
  //    returns is the only thing that can translate it afterwards.
  const absorbedState = await getCountryState(db, challenger);
  const absorbedRulingPartyId = absorbedState.rulingPartyId ?? null;

  // 1b. Also read BEFORE the merge: `mergeCountry` retires the absorbed shell
  //     (flips `enabledForPlayers` off), and whether the SURVIVOR opens to
  //     players afterwards depends on whether the absorbed side was open. Read
  //     it after the merge and the answer is always no.
  const absorbedGameState = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: challenger }, { projection: { enabledForPlayers: 1, status: 1 } });
  const absorbedWasPlayable = absorbedGameState?.enabledForPlayers === true;

  // 2. Parties before regions. `characters.party` and `electedOfficials.party`
  //    hold a per-country `sequentialId`, so a row that moves country before its
  //    party is renumbered is silently reinterpreted against the survivor's list
  //    — East Germany's communists would read as West German social democrats.
  //    The damage is not reversible, because the old value is gone.
  const partiesMerged = await mergePartiesIntoCountry(db, {
    fromCountryId: challenger,
    toCountryId: target,
    currentTurn,
  });
  if (!partiesMerged.ok) {
    return release(partiesMerged.error ?? "The party migration did not complete.");
  }

  // 3. The regions and everyone seated in them.
  const merged = await mergeCountry(db, {
    fromCountryId: challenger,
    toCountryId: target,
    currentTurn,
  });
  if (!merged.ok) {
    // The claim is GIVEN BACK, so the next tick resumes this merge from the
    // region it stopped on rather than leaving the world half-absorbed.
    return release(merged.error ?? "The merge did not complete.");
  }

  // 3b. National officeholders the region sweep cannot see.
  //
  //     `evacuateRegionPolitics` works per region and matches on `state`, so an
  //     official with no region — East Germany's Chairman of the Council of State
  //     is exactly this — is never visited by it, and would be left seated on a
  //     country that no longer exists. Same for a cabinet seat held by an NPP
  //     rather than a player.
  const rulingPartyId = carriedRulingParty(absorbedRulingPartyId, partiesMerged.partyIdMap);
  await retireNationalRemnants(db, {
    absorbed: challenger,
    survivor: target,
    currentTurn,
    rulingPartyId,
  });

  // 3c. The national balance sheet: treasury, debt, defence account, the
  //     sovereign bonds real players hold, and the national law book — all
  //     FX-converted. Without this the ghost treasury pays coupons until it
  //     defaults for a country that no longer exists, and the unified budget
  //     forgets every national programme the absorbed state legislated.
  const fisc = await mergeNationalFisc(db, {
    fromCountryId: challenger,
    toCountryId: target,
    currentTurn,
  });

  // 3d. The armed forces. The military collections are country-keyed, not
  //     region-keyed, so the region sweep never sees them — and a settlement
  //     that let the winning side's army evaporate would be absurd.
  await mergeMilitary(db, { fromCountryId: challenger, toCountryId: target });

  // 3e. The ECONOMIC regime. `installOnePartyState` below converts the political
  //     system, but the command economy is its own per-country dial; without
  //     this carry a victorious SED would find itself running West Germany's
  //     market machinery. Year through `yearOfTurn` (calendar, not raw turn —
  //     the #1208 class of bug) for the schedule fallback.
  const gameStateDoc = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { startingYear: 1, preIteration: 1, preIterationTurns: 1 } }
    );
  const currentYear = yearOfTurn(currentTurn, gameStateDoc?.startingYear ?? STARTING_YEAR, {
    preIterationActive: gameStateDoc?.preIteration?.active,
    preIterationTurns: gameStateDoc?.preIterationTurns,
  });
  await mergeEconomicRegime(db, {
    fromCountryId: challenger,
    toCountryId: target,
    currentYear,
  });

  // 4. East Berlin into Berlin, AFTER the country merge and not before: both
  //    regions must be under one flag, and BEO is East German until step 3 runs.
  //    Germany's seed has no `DE-bundestag-BEO` because a unified Berlin is one
  //    city, which is the whole reason this step exists.
  const berlin = await mergeRegion(db, {
    fromRegionId: GERMAN_QUESTION_EAST_BERLIN,
    toRegionId: GERMAN_QUESTION_BERLIN,
    currentTurn,
  });
  if (!berlin.ok) {
    return release(berlin.error ?? "East Berlin could not be merged into Berlin.");
  }

  // 5. The unified state takes the winner's constitutional settlement. Both of
  // these are runtime documents, which is exactly why this direction is the
  // buildable one.
  await adoptChallengerSettlement(db, {
    survivor: target,
    absorbed: challenger,
    currentTurn,
    partyIdMap: partiesMerged.partyIdMap,
    absorbedRulingPartyId,
  });

  // 6. The unified state opens to players when the absorbed side was open. The
  //    carried citizens are real accounts — 19 of them in the live German
  //    Question — and landing the WINNERS in a read-only econ country would
  //    lock every one of them out of the game they just won. The absorbed shell
  //    needs nothing here: `mergeCountry` already stamped `dissolvedTurn`,
  //    which is the one dissolution marker everything honors (deliberately NOT
  //    a `CountryStatus` value — see that field's doc).
  if (absorbedWasPlayable) {
    await db
      .collection<CountryGameState>("countryGameStates")
      .updateOne(
        { _id: target },
        { $set: { enabledForPlayers: true, status: "active", updatedAt: new Date() } },
        { upsert: true }
      );
  }

  await recordCountryEvent(db, {
    countryId: target,
    turn: currentTurn,
    eventType: "international_relations",
    title: "The German Question carried: one Germany, in the Warsaw Pact.",
    details: {
      crisis: crisis.kind,
      outcome: crisis.outcome,
      absorbed: challenger,
      regionsTransferred: merged.regionsTransferred,
      treasuryMoved: fisc.treasuryMoved,
      bondsAssumed: fisc.bondsRescoped,
      lawsCarried: fisc.lawsRescoped,
    },
  });
  await finish();
  return { actuated: true, outcome: "challenger", deferred: false };
}

/**
 * Which party rules the unified state, under its POST-MIGRATION number.
 *
 * ONE definition, read by both the government carry and the one-party install,
 * because the two must never disagree about who won.
 *
 * The fallback matters more than it looks. When the absorbed country records no
 * ruling party — it was not a one-party state before the settlement imposed one
 * — there is no winner's party to name, and letting `installOnePartyState`
 * resolve it instead reads the SURVIVOR's formed government and installs the
 * side that just lost, banning the winner.
 *
 * The stand-in is the absorbed state's FIRST party, by its own original
 * numbering. That is its principal party by the seeding convention (East
 * Germany's `1` is the SED), it is deterministic across re-runs, and whatever
 * else it is, it is not the survivor's incumbent — which is the failure this
 * exists to rule out.
 *
 * Null only when nothing was carried at all, which is a country with no parties.
 */
function carriedRulingParty(
  absorbedRulingPartyId: number | null,
  partyIdMap: Record<string, string>
): number | null {
  if (absorbedRulingPartyId != null) {
    const mapped = Number(partyIdMap[String(absorbedRulingPartyId)]);
    if (Number.isInteger(mapped)) return mapped;
  }
  // Keyed on the smallest ORIGINAL id rather than the smallest new one: the new
  // ids are handed out in whatever order the parties were read, which is not a
  // contract, while the old numbering is the source's own.
  const oldest = Object.keys(partyIdMap)
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b)[0];
  if (oldest === undefined) return null;
  const mapped = Number(partyIdMap[String(oldest)]);
  return Number.isInteger(mapped) ? mapped : null;
}

/**
 * The head-of-government fields, narrowed to what the carry reads and writes.
 * `governmentFormations` is keyed by country id, not by ObjectId.
 */
interface GovernmentFormationHead {
  _id: CountryId;
  pmCharacterId?: ObjectId | null;
  pmNppId?: ObjectId | null;
  updatedAt?: Date;
}

/**
 * Point one office holder's stored `currentOffice` at the surviving country's
 * executive key.
 *
 * TWO WRITES, because `$set` on a dotted path THROWS when the parent is null:
 * "Cannot create field 'type' in element {currentOffice: null}". A carried head
 * of government reaches this with a null `currentOffice` whenever their only
 * office was a cabinet portfolio the remap retired a few lines earlier — the
 * clear runs first — and a throw there would abort the merge half-done, after
 * the cooldown has already been claimed and cannot retry.
 *
 * The object case re-points `.type` alone, so `.state` and anything else on the
 * sub-document survive. The null case writes the whole field, because there is
 * nothing there to merge into.
 */
async function takeExecutiveOffice(
  db: Db,
  collection: "characters" | "npps",
  holderId: ObjectId,
  execKey: string,
  now: Date
): Promise<void> {
  const coll = db.collection(collection);
  await coll.updateOne(
    { _id: holderId, currentOffice: { $type: "object" } },
    { $set: { "currentOffice.type": execKey, updatedAt: now } }
  );
  await coll.updateOne(
    { _id: holderId, currentOffice: { $not: { $type: "object" } } },
    { $set: { currentOffice: { type: execKey }, updatedAt: now } }
  );
}

/**
 * Let go of a portfolio that no longer exists.
 *
 * `cabinetPosition` and a `currentOffice` naming a portfolio would otherwise
 * point at a row that has been deleted, in a country that may never have had it.
 *
 * A minister who ALSO holds an elected seat keeps the seat: only the portfolio
 * is cleared, and their `currentOffice` was already re-pointed at the carried
 * office by the region sweep. That is why the `currentOffice` null-out is
 * filtered on `parliamentaryCabinet` while the `cabinetPosition` unset is not.
 *
 * A seat can be held by a player OR an NPP, and both carry the same stored
 * office field — handling only the player leaves an NPP minister pointing at a
 * portfolio that no longer exists.
 */
async function clearCabinetPointers(
  db: Db,
  ministers: Array<{ characterId?: ObjectId | null; nppId?: ObjectId | null }>,
  now: Date
): Promise<void> {
  const characterIds = ministers.map((m) => m.characterId).filter(Boolean) as ObjectId[];
  const nppIds = ministers.map((m) => m.nppId).filter(Boolean) as ObjectId[];

  if (characterIds.length > 0) {
    await db
      .collection("characters")
      .updateMany(
        { _id: { $in: characterIds }, "currentOffice.type": "parliamentaryCabinet" },
        { $set: { currentOffice: null, updatedAt: now }, $unset: { cabinetPosition: "" } }
      );
    await db
      .collection("characters")
      .updateMany(
        { _id: { $in: characterIds }, "currentOffice.type": { $ne: null } },
        { $unset: { cabinetPosition: "" }, $set: { updatedAt: now } }
      );
  }

  if (nppIds.length > 0) {
    await db
      .collection("npps")
      .updateMany(
        { _id: { $in: nppIds }, "currentOffice.type": "parliamentaryCabinet" },
        { $set: { currentOffice: null, updatedAt: now } }
      );
  }
}

/**
 * Deal with what the per-region sweep cannot reach.
 *
 * `evacuateRegionPolitics` runs once per region and matches officials on
 * `state`, so anything held at NATIONAL level is invisible to it. East Germany's
 * Chairman of the Council of State carries no region at all, and would otherwise
 * sit for ever on a country that no longer exists. NPP-held cabinet seats have
 * the same shape: the region sweep only re-scopes the ones a resident PLAYER
 * holds.
 *
 * Offices with a counterpart are carried; offices without one retire. Seat counts
 * are NOT rescaled here, because a national office that is not tied to a region
 * is not part of any region's delegation.
 *
 * Runs after `mergeCountry`, so anything still pointing at the absorbed country
 * is genuinely a remnant rather than a region the sweep has not reached yet.
 */
async function retireNationalRemnants(
  db: Db,
  params: {
    absorbed: CountryId;
    survivor: CountryId;
    currentTurn: number;
    /** The absorbed ruling party under its NEW number, or null. */
    rulingPartyId: number | null;
  }
): Promise<void> {
  const { absorbed, survivor, rulingPartyId } = params;
  const now = new Date();

  const remnants = (await db
    .collection("electedOfficials")
    .find({ countryId: absorbed })
    .toArray()) as unknown as Array<{ _id: ObjectId; officeType: string }>;

  for (const official of remnants) {
    const target = remapOffice(absorbed, survivor, official.officeType);
    if (target === null) {
      await db.collection("electedOfficials").deleteOne({ _id: official._id });
      continue;
    }
    await db
      .collection("electedOfficials")
      .updateOne(
        { _id: official._id },
        { $set: { countryId: survivor, officeType: target, updatedAt: now } }
      );
  }

  // THE WINNER'S CABINET GOVERNS.
  //
  // The merge runs winner-into-shell, so the absorbed state's council is the
  // council of the unified state. Portfolios cross through
  // `dissolvingCabinetRemap` — the two constitutions do not share a vocabulary
  // (East Germany seats a `minister_of_defence`, Germany a `defense_minister`),
  // and the per-pair table is the same shape `dissolvingOfficeRemap` already
  // uses for elected offices. A portfolio with no counterpart retires with the
  // state that had it.
  //
  // The SURVIVOR's own ministers go first, and unconditionally. Leaving them
  // would seat the defeated side's cabinet beside the winner's — and in the live
  // German case those are NPP ministers of parties this settlement is about to
  // ban, holding portfolios the carried ministers are being given.
  //
  // `cabinetMembers.party` needs no remap here: it is in
  // `PARTY_REF_COLLECTIONS`, so `mergePartiesIntoCountry` renumbered it in step
  // 2, before any of this ran.
  //
  // ⚠️ SCOPED OFF THE CARRIED ROWS. Actuation is resumable, so this can run a
  // second time — and by then the absorbed ministers ARE the survivor's. Deleting
  // every row under the survivor would throw the winning cabinet away on the
  // resume that was meant to finish seating it. `mergedFrom` is the stamp that
  // tells them apart; `$ne` also matches rows with no stamp at all, which is
  // exactly the survivor's own.
  const notCarried = {
    countryId: survivor,
    "mergedFrom.countryId": { $ne: absorbed },
  };
  const survivorMinisters = (await db
    .collection("cabinetMembers")
    .find(notCarried)
    .toArray()) as unknown as Array<{ characterId?: ObjectId | null; nppId?: ObjectId | null }>;
  await db.collection("cabinetMembers").deleteMany(notCarried);
  await clearCabinetPointers(db, survivorMinisters, now);

  // Read BEFORE anything moves, because the rows are how the holders are found.
  const ministers = (await db
    .collection("cabinetMembers")
    .find({ countryId: absorbed })
    .toArray()) as unknown as Array<{
    _id: ObjectId;
    positionId?: string;
    characterId?: ObjectId | null;
    nppId?: ObjectId | null;
  }>;

  const retired: Array<{ characterId?: ObjectId | null; nppId?: ObjectId | null }> = [];
  for (const minister of ministers) {
    const target = minister.positionId
      ? remapCabinetPosition(absorbed, survivor, minister.positionId)
      : null;
    if (target === null) {
      await db.collection("cabinetMembers").deleteOne({ _id: minister._id });
      retired.push(minister);
      continue;
    }
    await db.collection("cabinetMembers").updateOne(
      { _id: minister._id },
      {
        $set: {
          countryId: survivor,
          positionId: target,
          // The stamp that keeps a resume from deleting this row as though it
          // were the survivor's own.
          mergedFrom: { countryId: absorbed, positionId: minister.positionId ?? null },
          updatedAt: now,
        },
      }
    );
    // The holder's denormalised pointer names the OLD portfolio. Re-point it
    // rather than clearing it: this minister keeps their seat at the table.
    if (minister.characterId) {
      await db.collection("characters").updateMany(
        { _id: minister.characterId, "currentOffice.type": "parliamentaryCabinet" },
        {
          $set: {
            "currentOffice.positionId": target,
            cabinetPosition: target,
            updatedAt: now,
          },
        }
      );
    }
    if (minister.nppId) {
      await db
        .collection("npps")
        .updateMany(
          { _id: minister.nppId, "currentOffice.type": "parliamentaryCabinet" },
          { $set: { "currentOffice.positionId": target, updatedAt: now } }
        );
    }
  }

  await clearCabinetPointers(db, retired, now);

  // THE HEAD OF GOVERNMENT IS CARRIED.
  //
  // The winning side's leader leads the unified state — that is the whole
  // constitutional point of the settlement. The office KEY stays the survivor's
  // (`chancellor`); the title a player sees is resolved from `governmentType`,
  // which `installOnePartyState` is about to set to `onePartyState`.
  //
  // A player leader is carried by `pmCharacterId` and an NPP one by `pmNppId`,
  // and the two are mutually exclusive: leaving the survivor's NPP chancellor in
  // place beside a carried player would leave two people holding one office.
  // Read BEFORE the delete below — the row is how the carried head of
  // government is found.
  const formations = db.collection<GovernmentFormationHead>("governmentFormations");
  const absorbedGov = await formations.findOne({ _id: absorbed });

  if (absorbedGov?.pmCharacterId || absorbedGov?.pmNppId) {
    // Era-aware, and read ONCE for the whole handover below. `officeTypes` IS
    // overridden per preset for several countries, so resolving the key without
    // the active preset is the same class of bug as the static-config reads this
    // change set exists to fix -- harmless for DE today only because DE carries
    // no override.
    const execKey = getExecutiveOfficeKey(survivor, await getGameStatePresetOrDefault(db));

    // THE DISPLACED LEADER STANDS DOWN FIRST.
    //
    // Clearing `pmNppId` takes the survivor's chancellor off the formation row,
    // but `currentOffice` is a STORED denormalisation and does not follow: the
    // outgoing leader would go on reading as chancellor on their own profile,
    // in `deriveHighestOffice`, and everywhere else that ranks an office off
    // that field — two people holding one office, which is the exact thing the
    // note above says this must not do. `parliamentaryGovernment` clears it the
    // same way whenever it seats a new PM; this path had simply never done it.
    //
    // Scoped by country AND executive key so it cannot reach a leader of another
    // country, or a minister of this one.
    //
    // ⚠️ THE INCOMING LEADER IS EXCLUDED. Actuation is resumable, so this can run
    // again after the carried leader has already taken the survivor's executive
    // key — and an unqualified sweep would then stand down the very person it is
    // seating.
    const standDown = { $set: { currentOffice: null, updatedAt: now } };
    await db.collection("characters").updateMany(
      {
        countryId: survivor,
        "currentOffice.type": execKey,
        ...(absorbedGov.pmCharacterId ? { _id: { $ne: absorbedGov.pmCharacterId } } : {}),
      },
      standDown
    );
    await db.collection("npps").updateMany(
      {
        countryId: survivor,
        "currentOffice.type": execKey,
        ...(absorbedGov.pmNppId ? { _id: { $ne: absorbedGov.pmNppId } } : {}),
      },
      standDown
    );

    await formations.updateOne(
      { _id: survivor },
      {
        $set: {
          pmCharacterId: absorbedGov.pmCharacterId ?? null,
          pmNppId: absorbedGov.pmNppId ?? null,
          // THE GOVERNING PARTY MOVES WITH THE GOVERNMENT.
          //
          // `updateParliamentaryGovernmentSeats` does NOT recompute this for an
          // already-formed government -- it reads `existing.governingPartyId` to
          // size the government's support -- so a stale value does not heal on
          // the next tick. Left alone, unified Germany would go on naming the
          // SPD as its governing party while the SED ruled: its support would be
          // counted from the wrong benches, and `applyWhipVotes` would treat the
          // opposition's members as the government's.
          ...(rulingPartyId != null ? { governingPartyId: String(rulingPartyId) } : {}),
          updatedAt: now,
        },
      }
    );

    // THE CARRIED LEADER TAKES THE SURVIVOR'S OFFICE KEY.
    //
    // `currentOffice.type` still names the office they held in the country that
    // no longer exists — East Germany's `generalSecretary`, which is not an
    // office the Federal Republic defines. That is the same defect
    // `evacuateRegionPolitics` re-points every ordinary official to avoid: a
    // holder left on a key their country does not list shows a defunct title and
    // matches nothing that looks the office up in the country's config.
    //
    // Only `.type` is written where there is an office to re-point. `.state` is
    // left alone: `mergeRegion` re-points it when the region it names is the one
    // being fused away, and that runs after this.
    if (absorbedGov.pmCharacterId) {
      await takeExecutiveOffice(db, "characters", absorbedGov.pmCharacterId, execKey, now);
    }
    if (absorbedGov.pmNppId) {
      await takeExecutiveOffice(db, "npps", absorbedGov.pmNppId, execKey, now);
    }

    // THE MANDATE COMES WITH THE LEADER.
    //
    // `countryLeaderStates` is keyed `${countryId}_${characterId}`, so the
    // record does not follow the head of government the way the formation row
    // above does: the carried leader would arrive in the unified state with no
    // mandate on record, and the next `installNewLeader` would seat them at a
    // fresh 75 as though they had just taken power, erasing the tenure they won
    // the war with.
    //
    // Only a PLAYER leader has one. An NPP head of government is carried by
    // `pmNppId` and holds no character-keyed record, which is why this reads
    // `pmCharacterId` alone rather than the same condition as the block above.
    if (absorbedGov.pmCharacterId) {
      await carryLeaderStateOnMerge(db, {
        fromCountryId: absorbed,
        toCountryId: survivor,
        leaderCharacterId: absorbedGov.pmCharacterId,
        // The SURVIVOR's executive key. The office the leader now holds is
        // Germany's chancellorship, not the GDR post the record was written under.
        leaderOfficeType: execKey,
        governingPartyId: rulingPartyId != null ? String(rulingPartyId) : null,
        currentTurn: params.currentTurn,
      });
    }
  }

  // The absorbed state's own formation row goes with the state. Left in place
  // it still reads "formed", with a prime minister and a governing party — and
  // the parliamentary phase loop, which iterates the static country list, would
  // keep running seat sync, confidence processing and NPP appointment against a
  // government of a country that no longer exists.
  await formations.deleteOne({ _id: absorbed });
}

/**
 * Give the surviving shell the winner's character: the absorbed state's
 * government type, and its side of the Cold War.
 *
 * `countryState.governmentType` is read at runtime by `getHeadOfGovernment` and
 * `isSittingLeader`, so flipping it moves the whole executive-resolution path
 * over in a single write.
 *
 * Bloc membership is an organisation row, so the re-alignment is three ordinary
 * membership writes rather than anything bespoke: the survivor LEAVES the western
 * alliance, JOINS the eastern one, and the dissolved challenger comes off both
 * rolls. Each step's ordering is argued at its call site — all three are
 * unretryable, because the cooldown is claimed before any of them run.
 */
async function adoptChallengerSettlement(
  db: Db,
  params: {
    survivor: CountryId;
    absorbed: CountryId;
    currentTurn: number;
    /** old to new party `sequentialId`, from the migration. */
    partyIdMap: Record<string, string>;
    /** The absorbed country's ruling party, under its OLD number. */
    absorbedRulingPartyId: number | null;
  }
): Promise<void> {
  const mappedRulingParty = carriedRulingParty(params.absorbedRulingPartyId, params.partyIdMap);

  // The full one-party install, not just a `governmentType` copy: it also sets
  // `rulingPartyId`, restores `opsVoteMultipliers` and `hasLeaderConfidenceModel`,
  // marks the ruling party `ruling` and every other party `banned`, and seeds the
  // regime-escalation row the per-turn driver needs.
  //
  // ⚠️ NO `pendingPostConversionElection` IS WRITTEN, and that is deliberate.
  // Every other route into a conversion schedules one; this one must not, because
  // the whole point of the merge is that the carried chamber keeps sitting. A
  // snap election here would dissolve the seats this pipeline just preserved.
  // Do not "fix" the omission — `reunification.e2e.test.ts` asserts it.
  // THE WINNER'S OWN SETTLEMENT, NOT A BARE ONE-PARTY INSTALL.
  //
  // `toleratedPartyIds` is every party that CROSSED — the map's values are the
  // absorbed country's parties under their post-migration numbers — so the
  // GDR's National Front bloc (CDU-Ost, LDPD, NDPD, DBD) arrives as `approved`
  // rather than banned. Without this the winning side would dissolve its own
  // coalition partners at the moment it won, which is not the settlement it
  // fought for; the default (ban everyone but the ruler) stays right for the
  // `regime_change` peace term, which is a system imposed from outside.
  //
  // Everything NOT in that set is the survivor's own party list, and those are
  // banned — and `vacateBannedSeats` empties the offices they hold. Left seated
  // they would be 71% of a chamber in a state where they are outlawed, and the
  // ruling party would govern as a 28.9% minority of benches nominally opposed
  // to it. The seats are vacated, not reassigned: the chamber keeps its nominal
  // size and the western Laender stand empty until something fills them.
  const carriedPartyIds = Object.values(params.partyIdMap)
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id));
  await installOnePartyState(db, params.survivor, params.currentTurn, {
    ...(mappedRulingParty != null ? { rulingPartyId: mappedRulingParty } : {}),
    toleratedPartyIds: carriedPartyIds,
    vacateBannedSeats: true,
  });

  // The survivor may now legislate in the catalogue it inherited. Without this a
  // one-party socialist Germany could propose nothing but West German tax law.
  await rescopeLegislationCatalogue(db, params.absorbed, params.survivor);

  const preset = await getGameStatePresetOrDefault(db);
  const pactOrg = blocOrgFor(preset, "east");
  // Silent no-op when the era has no eastern accession organisation — the
  // honest answer rather than inventing a membership in a body that never
  // existed in this world's year.
  //
  // EVERYTHING BELOW HANGS OFF THAT SAME GATE. Stripping the western alliance in
  // an era with no eastern one to join would leave a unified Germany aligned
  // with nobody, which is not "the honest answer" — it is a third outcome the
  // design never described, reached silently. No Pact, no re-alignment.
  if (!pactOrg) return;

  const westOrg = blocOrgFor(preset, "west");
  // ONE GERMANY, ONE ALLIANCE. `admitMember` only ever inserts, so without the
  // withdrawal a surviving shell already in NATO — which DE is, in the 1953 era —
  // comes out of reunification holding a row in BOTH poles. That is not a
  // cosmetic duplicate: `loadBlocMembership` writes `out[countryId] = bloc` per
  // row with no precedence, so which bloc a unified Germany reads as would come
  // down to the order Mongo happened to return two documents in, and every
  // military and alignment call downstream reads that map.
  //
  // WEST FIRST, THEN EAST, and the order is load-bearing. `actuateSettlementOutcome`
  // claims the cooldown before any of this runs, so it never retries: whatever
  // state a throw in the middle leaves behind is permanent. Ending up in NEITHER
  // pole is wrong but deterministic and legible to an admin; ending up in BOTH is
  // the non-deterministic read above. Fail toward the one somebody can see.
  await leaveBloc(db, westOrg, pactOrg, {
    countryId: params.survivor,
    currentTurn: params.currentTurn,
  });
  await admitMember(db, pactOrg, params.survivor, params.currentTurn);

  // The absorbed state is dissolved, and `mergeCountry` does not touch
  // organisation rows — it moves regions and retires the shell. Left alone, the
  // GDR stays on the Warsaw Pact roll for ever: `getMembers` keeps listing it and
  // `loadBlocMembership` keeps answering "east" for a country that no longer
  // exists. `votingMembers` already drops it (the retirement clears
  // `enabledForPlayers`), so this is about the roll a player reads, and about not
  // leaving a dissolved country holding a chair it can never vacate.
  //
  // Bloc organisations ONLY. A dissolved country lingering in COMECON or the UN is
  // the same defect, but it belongs to `mergeCountry` — every merge has it, not
  // just this one — and inventing a general cleanup here would hide it.
  //
  // LAST, and after the admission, by the same argument as the ordering above: a
  // throw here leaves the survivor correctly in the Pact with a stale GDR row
  // beside it, which is untidy. Moving it earlier would trade that for a survivor
  // in no alliance at all, which is the state the design has no name for.
  //
  // A Set because the two poles can resolve to the same organisation in a
  // misconfigured era, and withdrawing twice would write the history entry twice.
  for (const orgId of new Set([pactOrg, westOrg])) {
    await leaveBloc(db, orgId, null, {
      countryId: params.absorbed,
      currentTurn: params.currentTurn,
    });
  }
}

/**
 * Take a country out of one bloc organisation, if it is actually in it.
 *
 * `removeOrganizationMembership` and NOT `withdrawFromOrg`, which is the other
 * function in this codebase with this shape. That one is unreferenced, takes a
 * character it only uses for a history detail, terminates every affected
 * agreement outright, and never touches pending leadership elections. This one
 * is the path a real withdrawal already goes through — its own header says it is
 * shared by the two live leave routes "so both behave identically" — and it
 * additionally rejects leadership elections the leaver is standing in or
 * nominating, and tells the REMAINING members somebody left. A settlement that
 * dissolved a country should not leave it on a ballot inside the alliance it
 * just left.
 *
 * The membership test is not belt-and-braces. Every side effect above fires
 * unconditionally, including a history entry written to each remaining member —
 * so calling this for a country that was never in the organisation would tell
 * the whole alliance about a withdrawal that never happened.
 *
 * `skip` guards the degenerate era where one organisation carries both poles:
 * withdrawing from the alliance we are about to join would undo the admission.
 */
async function leaveBloc(
  db: Db,
  orgId: string | null,
  skip: string | null,
  params: { countryId: CountryId; currentTurn: number }
): Promise<void> {
  if (!orgId || orgId === skip) return;
  const org = orgId as InternationalOrganizationId;
  if (!(await isMember(db, org, params.countryId))) return;
  // Bloc organisations are always built-in — `loadBlocMembership` drops any
  // channel whose id is not in this table, so `blocOrgFor` cannot return a custom
  // one and the constant lookup needs no database read.
  //
  // The `keyof` cast is load-bearing: `InternationalOrganizationId` also covers
  // player-founded organisations, which this table does not key, so indexing it
  // with the wider type is an implicit `any`. The `?? org` below is what makes the
  // cast safe rather than merely quiet.
  const name =
    INTERNATIONAL_ORGANIZATIONS[org as keyof typeof INTERNATIONAL_ORGANIZATIONS]?.name ?? org;
  await removeOrganizationMembership(db, params.countryId, org, name, params.currentTurn);
}
