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
 * WHICH SHELL SURVIVES, AND WHY IT IS THE CHALLENGER.
 *
 * The winner's shell survives: the GDR absorbs the Federal Republic. This was
 * once built the other way round, on the argument that a country's NAME is
 * immutable seed data and a unified Germany must not render as "East Germany".
 * That argument weighed the name and counted nothing else.
 *
 * The name needs a runtime override EITHER way — the Federal Republic renders as
 * "West Germany" for as long as the GDR exists, so a unified state under that
 * shell is just as wrong. Everything else is free on this side and expensive on
 * the other. The winner's CURRENCY is read at 243 sites, with a reverse map at
 * 106 more that already pairs the Mark with the GDR; its GOVERNMENT TYPE and its
 * party REGIME STATUSES are already what a victorious SED would install. Under
 * the other shell each of those needs its own runtime override on top of
 * compiled config. One override against three.
 *
 * The display layer answers the name question in `resolveCountryIdentity`, which
 * reads `countryState` rather than the compiled config, so a unified Germany is
 * called Germany wherever a reader meets it.
 *
 * What a player sees is the outcome the design describes: one country called
 * Germany, one-party, in the Warsaw Pact, holding every Land, paying in the
 * currency it won the war with.
 */
import type { Db, ObjectId } from "mongodb";
import type { SettlementCrisisDoc, SettlementOutcome } from "@/lib/db/types/settlementCrisis";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
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
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { mergeCountry } from "@/lib/country/mergeCountry";
import { getCountryState, updateCountryState } from "@/lib/countryState";
import { adjustLeaderConfidence, REUNIFICATION_BUMP } from "@/lib/turn/rulingPartyConfidence";
import { getCountryLeaderStatesCollection } from "@/lib/db/collections/countryLeaderState";
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

/**
 * What the unified state is called once the two Germanies are one.
 *
 * Not read off either config: the GDR's is "East Germany" and the Federal
 * Republic's renders as "West Germany" under the era alias, and a reunified
 * country is neither half.
 */
const UNIFIED_GERMANY_NAME = "Germany";

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

  // challenger — the merge. THE CHALLENGER IS THE SHELL THAT SURVIVES, and the
  // incumbent is absorbed into it.
  //
  // ⚠️ THIS DIRECTION WAS ONCE THE OTHER WAY ROUND, on the argument that a
  // country's NAME is immutable seed data and a unified Germany must not render
  // as "East Germany". That reasoning weighed the name and counted nothing else,
  // and the name needed a runtime override EITHER way — the Federal Republic
  // renders as "West Germany" for as long as the GDR exists. Everything else is
  // free on this side and expensive on the other: the winner's CURRENCY (read at
  // 243 sites, with a reverse map at 106 more that already pairs the Mark with
  // the GDR), its GOVERNMENT TYPE, and its party REGIME STATUSES are all already
  // correct when the winner is the shell. A country that wins the war does not
  // hand over its money and its constitution to the side that lost.
  //
  // ORDER IS LOAD-BEARING at every step, and each is argued at its own call site.
  //
  //   1. the SURVIVOR's ruling party is read; it does not move, so it needs no map
  //   2. the loser's parties MOVE, before anything reads a party id
  //   3. the country MERGES, carrying regions and officials
  //   4. East Berlin FUSES into Berlin, once both are German
  //   5. the settlement is ADOPTED, once the chamber it reads exists
  const survivor = challenger;
  const absorbed = target;

  // 1. The ruling party is the SURVIVOR's own, and stays put: its parties are not
  //    the ones being renumbered, so there is no map to translate it through. This
  //    is the whole saving of putting the winner in the shell — the side that won
  //    keeps its ruling party by doing nothing.
  const survivorState = await getCountryState(db, survivor);
  const survivorRulingPartyId = survivorState.rulingPartyId ?? null;

  // 1b. Also read BEFORE the merge: `mergeCountry` retires the absorbed shell
  //     (flips `enabledForPlayers` off), and whether the SURVIVOR opens to
  //     players afterwards depends on whether the absorbed side was open. Read
  //     it after the merge and the answer is always no.
  //
  //     ⚠️ PERSISTED ON FIRST LOOK, because this function is re-enterable. "Before
  //     the merge" is only true of the FIRST attempt; a resume arrives after the
  //     shell is already retired and would read false every time. That is not
  //     theoretical — it happened on the live reunification and left nineteen
  //     real accounts locked out of the country they had just won.
  let absorbedWasPlayable = crisis.absorbedWasPlayable ?? null;
  if (absorbedWasPlayable == null) {
    const absorbedGameState = await db
      .collection<CountryGameState>("countryGameStates")
      .findOne({ _id: absorbed }, { projection: { enabledForPlayers: 1, status: 1 } });
    absorbedWasPlayable = absorbedGameState?.enabledForPlayers === true;
    await crises.updateOne({ _id: crisis._id }, { $set: { absorbedWasPlayable } });
  }

  // 2. Parties before regions. `characters.party` and `electedOfficials.party`
  //    hold a per-country `sequentialId`, so a row that moves country before its
  //    party is renumbered is silently reinterpreted against the survivor's list
  //    — East Germany's communists would read as West German social democrats.
  //    The damage is not reversible, because the old value is gone.
  const partiesMerged = await mergePartiesIntoCountry(db, {
    fromCountryId: absorbed,
    toCountryId: survivor,
    currentTurn,
  });
  if (!partiesMerged.ok) {
    return release(partiesMerged.error ?? "The party migration did not complete.");
  }

  // 3. The regions and everyone seated in them.
  const merged = await mergeCountry(db, {
    fromCountryId: absorbed,
    toCountryId: survivor,
    currentTurn,
    // The winner's trade policy stands where both states taxed the same scope.
    // Same rule as the tax code and the reserve law: the shell is the victor
    // here, so the absorbed side does not get to keep its tariffs.
    absorbedTariffsWin: false,
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
  //     The ruling party needs no translation: it is the SURVIVOR's own, and the
  //     survivor's parties are not the ones that moved.
  const rulingPartyId = survivorRulingPartyId;
  await retireNationalRemnants(db, {
    absorbed,
    survivor,
    currentTurn,
    rulingPartyId,
  });

  // 3c. The national balance sheet: treasury, debt, defence account, the
  //     sovereign bonds real players hold, and the national law book — all
  //     FX-converted. Without this the ghost treasury pays coupons until it
  //     defaults for a country that no longer exists, and the unified budget
  //     forgets every national programme the absorbed state legislated.
  //     ⚠️ THE LEVERS DO NOT CROSS. The winner's-law rule assumes the absorbed
  //     side won; here the SURVIVOR is the winner, so carrying the absorbed
  //     side's tax code and wage floor would impose the LOSER's law on the
  //     victor. Quantities still cross — the treasury, the defence account, the
  //     bonds and the debt ceiling are how much the unified state holds and may
  //     borrow, not rules about how it behaves.
  const fisc = await mergeNationalFisc(db, {
    fromCountryId: absorbed,
    toCountryId: survivor,
    currentTurn,
    carryLegislatedLevers: false,
  });

  // 3d. The armed forces. The military collections are country-keyed, not
  //     region-keyed, so the region sweep never sees them — and a settlement
  //     that let the winning side's army evaporate would be absurd.
  //     ⚠️ STANCE DOES NOT CROSS, for the same reason the legislated levers do
  //     not: `mergeMilitary` defaults to the absorbed side's doctrine and
  //     reinforcement mode because a merge normally runs winner-into-shell. Here
  //     the SURVIVOR is the winner, so carrying them would hand the victor the
  //     military rules of the army it just defeated. The units, stock and
  //     manpower pool still cross — those are what the unified state has.
  await mergeMilitary(db, {
    fromCountryId: absorbed,
    toCountryId: survivor,
    carryStance: false,
  });

  // 3e. The ECONOMIC regime. `installOnePartyState` below converts the political
  //     system, but the command economy is its own per-country dial.
  //
  //     A NO-OP FOR THIS PAIRING, and deliberately left in. `mergeEconomicRegime`
  //     is ONE-DIRECTIONAL — it only ever makes the survivor more planned — so
  //     with the GDR as the shell the market half cannot "reform" the winner as a
  //     side effect of being absorbed, and the call returns without writing. It
  //     stays because the direction is a property of the settlement rather than of
  //     this pipeline, and because the guard doing the work lives in that function
  //     where a reader will look for it.
  //
  //     Year through `yearOfTurn` (calendar, not raw turn — the #1208 class of
  //     bug) for the schedule fallback.
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
    fromCountryId: absorbed,
    toCountryId: survivor,
    currentYear,
  });

  // 4. East Berlin into Berlin, AFTER the country merge and not before: both
  //    regions must be under one flag, and BE arrives from the Federal Republic
  //    only when step 3 runs.
  //
  //    BEO IS DISSOLVED EVEN THOUGH ITS COUNTRY WON, and that is not the shell
  //    rule contradicting itself. Region codes are geography, not sovereignty:
  //    `seedDD` treats the eastern Laender codes as DE's in a UNIFIED era and
  //    DD's only while the country is divided, with `BEO` the one code that is
  //    DD-exclusive. A unified Berlin is one city under the shared code, so the
  //    exclusive half is the half that goes.
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
    survivor,
    absorbed,
    currentTurn,
    partyIdMap: partiesMerged.partyIdMap,
    rulingPartyId,
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
        { _id: survivor },
        { $set: { enabledForPlayers: true, status: "active", updatedAt: new Date() } },
        { upsert: true }
      );
  }

  await recordCountryEvent(db, {
    countryId: survivor,
    turn: currentTurn,
    eventType: "international_relations",
    title: "The German Question carried: one Germany, in the Warsaw Pact.",
    details: {
      crisis: crisis.kind,
      outcome: crisis.outcome,
      absorbed,
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
 * Credit the reunification to the leader who delivered it.
 *
 * The winner's leader already holds their own `countryLeaderStates` record under
 * the surviving country, with their real tenure on it, so nothing has to move —
 * this is the bump, not a carry. It reads the sitting head of government off the
 * formation row rather than taking one as an argument, because the point is the
 * person actually holding the office after everything above has run.
 *
 * A no-op for an NPP leader: the record is character-keyed and an NPP holds none.
 * Best-effort, like the other credit paths — a settlement that has already moved
 * a country's borders must not fail over a confidence write.
 */
async function creditReunificationToLeader(
  db: Db,
  survivor: CountryId,
  currentTurn: number
): Promise<void> {
  const gov = await db
    .collection<GovernmentFormationHead>("governmentFormations")
    .findOne({ _id: survivor });
  if (!gov?.pmCharacterId) return;
  await adjustLeaderConfidence(
    db,
    survivor,
    gov.pmCharacterId,
    REUNIFICATION_BUMP,
    "Confidence gained from reunification",
    currentTurn
  ).catch((err) => console.error(`${survivor} reunification confidence credit failed:`, err));
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
 * `state`, so anything held at NATIONAL level is invisible to it. The Federal
 * Republic's central bank chair carries no region at all, and would otherwise sit
 * for ever on a country that no longer exists. NPP-held cabinet seats have the
 * same shape: the region sweep only re-scopes the ones a resident PLAYER holds.
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
    /**
     * The SURVIVOR's ruling party, or null. It needs no renumbering: the survivor
     * is the winner and its parties are not the ones the migration moved.
     */
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

  // THE LOSING GOVERNMENT FALLS. The winner is the shell, so its council is
  // already seated and needs nothing done to it; what has to happen is that the
  // ABSORBED state's ministers stop being ministers.
  //
  // The executive does not merge, and this is the one place where that is a
  // decision rather than a mechanic. A unified CHAMBER holds both sides' benches
  // — the seats carried above are real seats that real elections filled — but a
  // cabinet is the government of the day, and the settlement is precisely that
  // the losing side's government ends. Carrying its ministers into portfolios
  // beside the winner's would seat the defeated administration in the state that
  // defeated it.
  //
  // Read BEFORE the delete, because the rows are how the holders are found.
  const ministers = (await db
    .collection("cabinetMembers")
    .find({ countryId: absorbed })
    .toArray()) as unknown as Array<{ characterId?: ObjectId | null; nppId?: ObjectId | null }>;
  await db.collection("cabinetMembers").deleteMany({ countryId: absorbed });
  await clearCabinetPointers(db, ministers, now);

  // THE WINNER'S GOVERNMENT STAYS. The winner is the shell, so its head of
  // government is already seated and already holds the right office key; there is
  // nothing to carry and nobody to displace. What has to happen is that the
  // LOSING head of government stops holding an office in a country that no longer
  // exists.
  //
  // This block used to run the other way, and had to: when the shell was the
  // loser, the winner's leader had to be moved into it, their office key
  // re-pointed, and the displaced incumbent stood down without catching the
  // incoming leader in the same sweep. All of that machinery exists only because
  // the wrong side was surviving.
  const formations = db.collection<GovernmentFormationHead>("governmentFormations");
  const absorbedGov = await formations.findOne({ _id: absorbed });

  if (absorbedGov?.pmCharacterId || absorbedGov?.pmNppId) {
    // `currentOffice` is a STORED denormalisation and does not follow the
    // formation row being deleted below. Left alone the defeated leader goes on
    // reading as head of government on their own profile, in
    // `deriveHighestOffice`, and everywhere else that ranks an office off that
    // field.
    const standDown = { $set: { currentOffice: null, updatedAt: now } };
    if (absorbedGov.pmCharacterId) {
      await db.collection("characters").updateOne({ _id: absorbedGov.pmCharacterId }, standDown);
    }
    if (absorbedGov.pmNppId) {
      await db.collection("npps").updateOne({ _id: absorbedGov.pmNppId }, standDown);
    }
  }

  // THE GOVERNING PARTY IS RESTATED, not moved.
  //
  // `updateParliamentaryGovernmentSeats` does NOT recompute this for an
  // already-formed government -- it reads `existing.governingPartyId` to size the
  // government's support -- so a value that has drifted does not heal on the next
  // tick, and the unified state would count its support from the wrong benches
  // while `applyWhipVotes` treated the opposition as the government.
  if (rulingPartyId != null) {
    await formations.updateOne(
      { _id: survivor },
      { $set: { governingPartyId: String(rulingPartyId), updatedAt: now } }
    );
  }

  // THE MANDATE IS NOT CARRIED, IT IS CREDITED.
  //
  // The winner's leader already holds their own `countryLeaderStates` record
  // under the surviving country, with their real tenure on it -- nothing needs
  // to move. What they have not been given is the reunification itself, which is
  // the largest thing that will ever happen to their leadership.
  //
  // Only a PLAYER leader has such a record; an NPP head of government holds none.
  await creditReunificationToLeader(db, survivor, params.currentTurn);

  // The DEFEATED side's confidence records are orphaned, not carried.
  //
  // These are keyed `${countryId}_${characterId}`, so they do not follow the
  // country being dissolved and nothing else reaps them -- every reader queries
  // by a live country id, so the rows are unreachable rather than wrong. They
  // are deleted anyway: a dissolved state holding leadership records is the kind
  // of debris that reads as real the moment anyone re-enables the shell.
  await getCountryLeaderStatesCollection(db).deleteMany({ countryId: absorbed });

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
    /**
     * The SURVIVOR's ruling party. It needs no translation: the survivor is the
     * winner, and its parties are not the ones the migration renumbered.
     */
    rulingPartyId: number | null;
  }
): Promise<void> {
  const mappedRulingParty = params.rulingPartyId;

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
  // The parties that CROSSED are the LOSER's — the map's values are the absorbed
  // country's, under their post-migration numbers — and those are the ones this
  // settlement outlaws. The survivor's own list is everything else: its ruling
  // party, and the bloc it tolerates beside it. The GDR's National Front (CDU-Ost,
  // LDPD, NDPD, DBD) must stay `approved`, because a winner that dissolved its own
  // coalition partners at the moment it won is not the settlement it fought for.
  //
  // Read AFTER the migration, so the survivor's list already contains both sets
  // and the map is what tells them apart.
  //
  // `vacateBannedSeats` then empties the offices the outlawed parties hold. Left
  // seated they would be most of a chamber in a state where they are illegal, and
  // the ruling party would govern as a minority of benches nominally opposed to
  // it. The seats are vacated, not reassigned: the chamber keeps its nominal size
  // and those Laender stand empty until something fills them.
  const carried = new Set(
    Object.values(params.partyIdMap)
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id))
  );
  const survivorParties = (await db
    .collection("politicalParties")
    .find({ countryId: params.survivor }, { projection: { sequentialId: 1 } })
    .toArray()) as unknown as Array<{ sequentialId?: number }>;
  const toleratedPartyIds = survivorParties
    .map((party) => party.sequentialId)
    .filter(
      (id): id is number =>
        typeof id === "number" &&
        Number.isInteger(id) &&
        !carried.has(id) &&
        id !== mappedRulingParty
    );

  await installOnePartyState(db, params.survivor, params.currentTurn, {
    ...(mappedRulingParty != null ? { rulingPartyId: mappedRulingParty } : {}),
    toleratedPartyIds,
    vacateBannedSeats: true,
  });

  // THE UNIFIED STATE IS CALLED GERMANY.
  //
  // Neither half's name survives a reunification: the GDR's shell would go on
  // reading as "East Germany", and the Federal Republic's carries the era alias
  // "West Germany" for as long as the GDR exists. Both name one half of a country
  // that no longer has halves.
  //
  // A DISPLAY override, not a rename. `COUNTRY_CONFIGS.name` is the identity some
  // ninety synchronous call sites read and cannot change under them;
  // `resolveCountryIdentity` consults this instead wherever a reader is told what
  // the country is called. The absorbed side's compiled name is the right answer
  // here only by coincidence of this pairing, so the unified name is taken from
  // the ERA-NEUTRAL name of whichever shell is not the one that renders as a half.
  await updateCountryState(db, params.survivor, {
    displayNameOverride: UNIFIED_GERMANY_NAME,
    flagEmojiOverride: COUNTRY_CONFIGS[params.absorbed]?.flagEmoji ?? null,
  });

  // The survivor inherits the absorbed side's catalogue, and needs it for the
  // territory more than for the politics: the western Laender arrive already
  // holding enacted programmes whose legislation types are scoped to a country
  // that no longer exists. Left unscoped those regions read as having no current
  // law at all -- the same defect a regional default law was added to prevent --
  // and nothing they had passed could be amended or repealed.
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
  // WEST FIRST, THEN EAST, and the order is load-bearing. A throw between the two
  // is no longer permanent -- the actuation holds a LEASE now, and the next tick
  // re-enters and finishes -- but it is still visible to whoever looks before that
  // tick, and the withdrawal is not guaranteed to be the step that failed. Ending
  // up in NEITHER pole is wrong, deterministic, and legible to an admin; ending up
  // in BOTH is the non-deterministic read above, which resolves differently on
  // successive reads and would not obviously be a fault at all. Fail toward the
  // one somebody can see.
  await leaveBloc(db, westOrg, pactOrg, {
    countryId: params.survivor,
    currentTurn: params.currentTurn,
  });
  // GUARDED, because `admitMember` only ever INSERTS. With the winner as the
  // surviving shell the survivor is usually ALREADY in the eastern pole — it is
  // the side that was there all along — and an unguarded admission writes a second
  // membership row for a country that has one. `loadBlocMembership` keys a country
  // to whichever row it reads last, so a duplicate is not cosmetic: it makes the
  // country's own bloc a coin flip.
  if (!(await isMember(db, pactOrg as InternationalOrganizationId, params.survivor))) {
    await admitMember(db, pactOrg, params.survivor, params.currentTurn);
  }

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
  // beside it, which is untidy and which the resuming tick clears. Moving it
  // earlier would trade that for a survivor in no alliance at all, which is the
  // state the design has no name for.
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
