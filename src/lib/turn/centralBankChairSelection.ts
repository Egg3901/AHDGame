/**
 * Central Bank Chair Selection Phase
 *
 * Runs each turn after centralBankChairTurn (infamy/bonuses).
 * When a chair's term expires, selects a new chair from the executive
 * nomination pool. The market/wealth pool (30% of picks used to be drawn from
 * the nation's richest players) was removed: a chair is someone the executive
 * put forward, not whoever the leaderboard says is rich this turn.
 *
 * The selected player must **accept** before the appointment is finalized.
 * Refusals re-run the weighted draw with decliners excluded; with no
 * candidates the seat may stay vacant (or an NPP technocrat is seated when
 * autonomy is on).
 *
 * Lobbying funds shift weights within the pool. `ChairSelectionPending.pool`
 * keeps its "economic" arm only so pending docs written before the removal
 * still resolve.
 */

import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { CentralBank, ChairSelectionPending, FomcSeat } from "@/lib/db/types/centralBank";
import { FOMC_COMMITTEE_COUNTRY_IDS } from "@/lib/db/types/centralBank";
import type { Character } from "@/lib/db/types";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { createNotifications } from "@/lib/notifications";
import { createSystemNewsPost } from "@/lib/news";
import {
  notifyCbChairPendingDiscord,
  notifyCbChairAcceptedDiscord,
  notifyCbChairDeclinedDiscord,
} from "@/lib/centralBankChairEvents";
import { getBankId, getCentralBankScope } from "@/lib/centralBank/helpers";
import { getExecutiveCharacterIds, isExecutiveOffice } from "@/lib/elections/executiveOffice";
import { isNppAutonomyEnabled } from "@/lib/nppAutonomy/featureFlag";
import { appointNppChair } from "@/lib/nppAutonomy/appointNppChair";
import { makeSeededRng } from "@/lib/events/substrate/rng";
import { claimStatusTransition } from "@/lib/turn/atomicClaim";
import { logger } from "../observability/logger";
import { CHAIR_CHANGE_SCRUTINY_RETAINED } from "@/lib/centralBank/credibility";

// Optional global salt so headless sim runs can vary this RNG across runs
// while staying reproducible within a run (mirrors nppActionProcessing.ts).
const CB_CHAIR_RNG_SALT = process.env.SIM_RNG_SALT ? `:${process.env.SIM_RNG_SALT}` : "";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Chair term length in turns (4 years × 48 turns/year) */
export const CHAIR_TERM_TURNS = 4 * TURNS_PER_YEAR; // 192

/** Nomination window: last 48 turns of term (1 game year before expiry) */
export const NOMINATION_WINDOW_TURNS = 48;

/**
 * Turns a nominee has to accept a pending appointment before it lapses. On lapse
 * the pick is auto-refused: the nominee is excluded from the rest of this
 * selection cycle and a fresh candidate is drawn. The exclusion is per-cycle —
 * a nominee who lets the clock run out is eligible again in future cycles.
 */
export const CHAIR_ACCEPTANCE_WINDOW_TURNS = 24;

/** Lobbying scale: $500K doubles a candidate's selection weight */
export const LOBBY_SCALE_FACTOR = 500_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface PoolCandidate {
  characterId: ObjectId;
  characterName: string;
  lobbyingTotal: number;
}

export interface CentralBankChairSelectionResult {
  countriesChecked: number;
  selectionsTriggered: number;
  politicalPicks: number;
  economicPicks: number;
  vacanciesRemaining: number;
}

export interface ChairAppointmentResult {
  ok: boolean;
  error?: string;
}

export interface ChairDeclineResult {
  ok: boolean;
  error?: string;
  vacancy?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Weighted random pick from a pool. Weight = 1 + (lobbyingTotal / LOBBY_SCALE_FACTOR). */
export function weightedRandomPick(
  candidates: PoolCandidate[],
  rng: () => number = Math.random
): PoolCandidate | null {
  if (candidates.length === 0) return null;

  const weights = candidates.map((c) => 1 + c.lobbyingTotal / LOBBY_SCALE_FACTOR);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let roll = rng() * totalWeight;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }

  return candidates[candidates.length - 1];
}

/**
 * Check if the nomination window is open for a bank.
 *
 * A technocrat chair is a CARETAKER, not an incumbent: it holds the seat only
 * because no player was available when the seat last came up. Keeping the
 * window shut against it for the rest of a 4-year term means a country that
 * gains an eligible candidate has to wait years to put the name forward — which
 * is how every bank in the world ended up NPP-run with no way back. So an
 * NPP-chaired bank is always open for nominations.
 */
export function isNominationWindowOpen(
  bank: Pick<CentralBank, "chairCharacterId" | "chairTermExpiresAtTurn" | "chairMode">,
  currentTurn: number
): boolean {
  if (bank.chairCharacterId === null && bank.chairTermExpiresAtTurn === null) return true;
  if (bank.chairMode === "npp" && bank.chairCharacterId === null) return true;
  if (
    bank.chairTermExpiresAtTurn != null &&
    currentTurn >= bank.chairTermExpiresAtTurn - NOMINATION_WINDOW_TURNS
  )
    return true;
  return false;
}

/**
 * Clear any legacy `currentOffice.type === "centralBankChair"` from a former
 * chair. Chair status itself lives on `centralBanks.chairCharacterId`;
 * this is only a best-effort cleanup for documents written before the chair
 * role was decoupled from `currentOffice`.
 */
export async function vacateCentralBankChairCharacter(
  db: Db,
  chairCharacterId: ObjectId | null | undefined
): Promise<void> {
  if (!chairCharacterId) return;
  await db
    .collection("characters")
    .updateOne(
      { _id: chairCharacterId, "currentOffice.type": "centralBankChair" },
      { $set: { currentOffice: null } }
    );
}

async function selectChairCandidate(
  db: Db,
  bank: CentralBank,
  memberCountries: CountryId[],
  excludedCharacterIds: Set<string>,
  rng: () => number
): Promise<{
  candidate: PoolCandidate;
  appointedByExecutiveId: ObjectId | null;
} | null> {
  // Exclude every sitting national executive (head of government, deputy, and
  // ceremonial head of state) from both candidate pools — the central bank
  // must stay independent of the executive branch.
  const executiveIds = await getExecutiveCharacterIds(db, memberCountries);

  const lobbyTotals = new Map<string, number>();
  for (const entry of bank.lobbyingPool ?? []) {
    const key = entry.targetCharacterId.toString();
    lobbyTotals.set(key, (lobbyTotals.get(key) ?? 0) + entry.amount);
  }

  const politicalCandidates: PoolCandidate[] = [];
  for (const nom of bank.nominations ?? []) {
    if (excludedCharacterIds.has(nom.characterId.toString())) continue;

    const char = await db.collection<Character>("characters").findOne({
      _id: new ObjectId(nom.characterId),
      userId: { $exists: true },
    });
    if (!char) continue;
    if (executiveIds.has(char._id.toString())) continue;

    politicalCandidates.push({
      characterId: char._id,
      characterName: char.name,
      lobbyingTotal: lobbyTotals.get(char._id.toString()) ?? 0,
    });
  }

  const selectedCandidate = weightedRandomPick(politicalCandidates, rng);
  if (!selectedCandidate) return null;

  const winningNom = (bank.nominations ?? []).find(
    (nom) => nom.characterId.toString() === selectedCandidate.characterId.toString()
  );

  return {
    candidate: selectedCandidate,
    appointedByExecutiveId: winningNom ? winningNom.nominatedBy : null,
  };
}

async function notifyPendingNominee(
  db: Db,
  countryId: CountryId,
  characterId: ObjectId,
  characterName: string,
  pool: "political" | "economic",
  intorgId?: string
): Promise<void> {
  const config = COUNTRY_CONFIGS[countryId];

  // Country webhooks must not depend on in-app notification success or player-linked userId.
  notifyCbChairPendingDiscord(countryId, characterName, pool).catch((err) =>
    logger.error("CentralBankChairSelection", "Discord pending failed", err)
  );

  const character = await db.collection<Character>("characters").findOne({ _id: characterId });
  if (!character?.userId) return;

  await createNotifications([
    {
      userId: character.userId,
      type: "system",
      title: `${config.centralBank.chairTitle} appointment`,
      message: `You have been selected as the next ${config.centralBank.chairTitle} of the ${config.centralBank.name}. Visit the central bank page to accept or decline.`,
      metadata: {
        type: "central_bank_chair_pending",
        ...(intorgId ? { intorgId } : { countryId }),
        pool,
      },
    },
  ]);
}

export async function persistVacancy(db: Db, bankId: string, gameNow: Date): Promise<void> {
  await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: bankId },
    {
      $set: {
        chairCharacterId: null,
        chairCharacterName: null,
        chairAppointedAt: null,
        chairAppointedBy: null,
        // Scrutiny is the INSTITUTION's, not the person's: a new chair inherits
        // most of it. Zeroing it here made replacing the chair a credibility
        // laundromat — the cheapest way to erase a bad record was to churn
        // people. The retained fraction leaves a real honeymoon without making
        // the reset worth buying.
        resolveStreak: 0,
        chairTermExpiresAtTurn: null,
        chairSelectionPending: null,
        vacancyAwaitingAutomaticSelection: true,
        updatedAt: gameNow,
      },
      // Institutional scrutiny survives the person; the new chair inherits most
      // of it, so churning chairs is not a way to erase a bad record.
      $mul: { chairInfamy: CHAIR_CHANGE_SCRUTINY_RETAINED },
    }
  );
}

async function persistPendingProposal(
  db: Db,
  bank: CentralBank,
  proposal: ChairSelectionPending,
  gameNow: Date,
  notifyCountryId: CountryId,
  intorgId?: string
): Promise<void> {
  await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: bank._id },
    {
      $set: {
        chairCharacterId: null,
        chairCharacterName: null,
        chairAppointedAt: null,
        chairAppointedBy: null,
        // Scrutiny is the INSTITUTION's, not the person's: a new chair inherits
        // most of it. Zeroing it here made replacing the chair a credibility
        // laundromat — the cheapest way to erase a bad record was to churn
        // people. The retained fraction leaves a real honeymoon without making
        // the reset worth buying.
        resolveStreak: 0,
        chairTermExpiresAtTurn: null,
        chairSelectionPending: proposal,
        vacancyAwaitingAutomaticSelection: false,
        updatedAt: gameNow,
      },
      // Institutional scrutiny survives the person; the new chair inherits most
      // of it, so churning chairs is not a way to erase a bad record.
      $mul: { chairInfamy: CHAIR_CHANGE_SCRUTINY_RETAINED },
    }
  );

  await notifyPendingNominee(
    db,
    notifyCountryId,
    proposal.characterId,
    proposal.characterName,
    proposal.pool,
    intorgId
  );
}

// ─── Main Phase ───────────────────────────────────────────────────────────────

export async function processCentralBankChairSelection(
  db: Db,
  currentTurn: number,
  gameNow: Date
): Promise<CentralBankChairSelectionResult> {
  const result: CentralBankChairSelectionResult = {
    countriesChecked: 0,
    selectionsTriggered: 0,
    politicalPicks: 0,
    economicPicks: 0,
    vacanciesRemaining: 0,
  };

  const banks = await db.collection<CentralBank>("centralBanks").find({}).toArray();
  if (banks.length === 0) return result;

  const rng = makeSeededRng(`cbchair:${currentTurn}${CB_CHAIR_RNG_SALT}`);

  // Registered countries only: a country dissolved by a merge keeps its central
  // bank document, and this phase would otherwise go on running chair terms —
  // opening selections, appointing NPP chairs, posting news — for a dead
  // state's monetary authority.
  const registered = new Set(await getRegisteredCountryIds(db));

  const processedBankIds = new Set<string>();
  for (const countryId of COUNTRY_ORDER) {
    if (!registered.has(countryId)) continue;
    result.countriesChecked++;
    const bankId = getBankId(countryId);
    if (processedBankIds.has(bankId)) continue;
    processedBankIds.add(bankId);

    // Prefer the canonical bank document (shared banks use their sharedBankId
    // as _id, e.g. "ECB"). Falling back to countryId could pick a stale
    // per-country document if one still exists alongside the shared bank.
    const bank =
      banks.find((b) => b._id === bankId) ?? banks.find((b) => b.countryId === countryId);
    if (!bank) continue;
    const scope = await getCentralBankScope(db, countryId);

    // A pending pick that the nominee never answers must not freeze the seat
    // forever. Once the acceptance window lapses, auto-refuse it and re-draw —
    // excluding the lapsed nominee from the rest of this cycle.
    if (bank.chairSelectionPending) {
      const pending = bank.chairSelectionPending;
      const proposedTurn = pending.proposedAtTurn;
      if (
        typeof proposedTurn === "number" &&
        currentTurn - proposedTurn >= CHAIR_ACCEPTANCE_WINDOW_TURNS
      ) {
        result.selectionsTriggered++;
        const outcome = await reselectAfterRefusal(
          db,
          bank,
          countryId,
          pending,
          gameNow,
          currentTurn,
          "timeout"
        );
        if (outcome.vacancy) result.vacanciesRemaining++;
        else if (outcome.isPoliticalPick) result.politicalPicks++;
        else result.economicPicks++;
        console.log(
          `[CentralBankChairSelection] ${countryId}: appointment for ${pending.characterName} lapsed after ${CHAIR_ACCEPTANCE_WINDOW_TURNS} turns; ${
            outcome.vacancy ? "left vacant" : "re-selected"
          }`
        );
      }
      continue;
    }

    const termExpired =
      bank.chairTermExpiresAtTurn != null && currentTurn >= bank.chairTermExpiresAtTurn;

    const automaticVacancyFill = bank.vacancyAwaitingAutomaticSelection === true;

    // Bootstrap vacancy: a bank that has never had a chair (null term + null chair)
    // should still trigger selection so the first chair can be seated.
    //
    // A seated NPP caretaker is not a bootstrap. Those chairs always have
    // `chairCharacterId: null`, and after persistPendingProposal the term was
    // also nulled — treating that as "never seated" re-opened the draw every
    // turn, re-notified the nominee, and churned every bank in the world.
    // Reopen those seats with vacancyAwaitingAutomaticSelection (FOMC chair
    // rollover, resign, or an admin heal), not by inferring vacancy from the
    // player-mirror fields.
    const bootstrapVacancy =
      bank.chairCharacterId === null &&
      bank.chairTermExpiresAtTurn === null &&
      bank.chairMode !== "npp";

    if (!termExpired && !automaticVacancyFill && !bootstrapVacancy) continue;

    result.selectionsTriggered++;

    await vacateCentralBankChairCharacter(db, bank.chairCharacterId ?? undefined);

    const excluded = new Set<string>();
    const picked = await selectChairCandidate(db, bank, scope.memberCountries, excluded, rng);

    if (!picked) {
      // FOMC-committee banks (the US Fed) are staffed by presidential nomination
      // + Senate confirmation only — never by an engine-appointed technocrat.
      // With no eligible human queued, leave the chair vacant and wait for a
      // nomination rather than auto-stocking an NPP (the whole point of the
      // rework: no AI chair that "keeps re-appointing itself").
      if (FOMC_COMMITTEE_COUNTRY_IDS.has(countryId)) {
        logger.warn(
          "CentralBankChairSelection",
          `No candidates for ${countryId}; leaving the Fed chair vacant for presidential nomination`
        );
        result.vacanciesRemaining++;
        await persistVacancy(db, bank._id, gameNow);
      } else if (await isNppAutonomyEnabled(db)) {
        // Non-committee banks keep the caretaker technocrat when autonomy is on
        // and no eligible human exists. Human candidates were already preferred
        // above, so this cannot displace a player pick.
        await appointNppChair(db, bank, countryId, currentTurn);
      } else {
        logger.warn("CentralBankChairSelection", `No candidates for ${countryId}, leaving vacant`);
        result.vacanciesRemaining++;
        await persistVacancy(db, bank._id, gameNow);
      }
      continue;
    }

    result.politicalPicks++;

    const proposal: ChairSelectionPending = {
      characterId: picked.candidate.characterId,
      characterName: picked.candidate.characterName,
      pool: "political",
      proposedAt: gameNow,
      proposedAtTurn: currentTurn,
      appointedByExecutiveId: picked.appointedByExecutiveId,
      declinedCharacterIds: [],
    };

    await persistPendingProposal(db, bank, proposal, gameNow, countryId, scope.intorgId);

    console.log(
      `[CentralBankChairSelection] ${countryId}: pending ${picked.candidate.characterName} (nomination pool)`
    );
  }

  return result;
}

// ─── Accept / Decline (API routes) ───────────────────────────────────────────

export async function acceptCentralBankChairSelection(
  db: Db,
  countryId: CountryId,
  acceptingCharacterId: ObjectId,
  gameNow: Date,
  currentTurn: number
): Promise<ChairAppointmentResult> {
  const bank = await db.collection<CentralBank>("centralBanks").findOne({
    _id: getBankId(countryId),
  });
  if (!bank?.chairSelectionPending) return { ok: false, error: "No pending chair appointment" };

  const pending = bank.chairSelectionPending;
  if (!pending.characterId.equals(acceptingCharacterId))
    return { ok: false, error: "You are not the pending nominee" };

  const character = await db.collection<Character>("characters").findOne({
    _id: acceptingCharacterId,
  });
  if (!character?.userId) return { ok: false, error: "Character cannot accept this appointment" };

  // The central bank must stay independent of the executive branch. Catches an
  // elected executive who took office between proposal and acceptance; CN's
  // ceremonial President is already barred by the selection exclusion and the
  // per-turn executive-removal sweep, so currentOffice detection suffices here.
  if (isExecutiveOffice(character.currentOffice)) {
    return {
      ok: false,
      error: "Executive office-holders cannot also serve as central bank chair.",
    };
  }

  const config = COUNTRY_CONFIGS[countryId];

  await vacateCentralBankChairCharacter(db, bank.chairCharacterId ?? undefined);

  /*
   * Chair role is tracked on the centralBanks document (chairCharacterId),
   * not on character.currentOffice. Overwriting currentOffice here would wipe
   * any elected seat the incoming chair holds and strip the office bonus we
   * stack on top of the chair bonus in actionRefresh.
   */

  // Atomically claim the acceptance keyed on the pending nominee so a
  // double-submit (or a turn-phase lapse racing this accept) cannot seat the
  // chair twice and double-announce.
  // Seat the accepting player in the committee's chair seat too. Without this
  // the board kept the caretaker technocrat in seat 0: it tabled the motions,
  // its alignment drove policy, and the next time its term lapsed the seat
  // refresh overwrote the player's mirror fields and evicted them silently.
  const chairTermExpiresAtTurn = currentTurn + CHAIR_TERM_TURNS;
  const seatedBoard: FomcSeat[] | null = bank.fomcBoard?.length
    ? bank.fomcBoard.map((seat) =>
        seat.isChair
          ? {
              ...seat,
              occupantType: "player" as const,
              characterId: acceptingCharacterId,
              characterName: character.name,
              nppId: null,
              appointedByPresidentId: pending.appointedByExecutiveId ?? null,
              appointedAtTurn: currentTurn,
              termExpiresAtTurn: chairTermExpiresAtTurn,
            }
          : seat
      )
    : null;

  const claimed = await claimStatusTransition(
    db,
    "centralBanks",
    { _id: bank._id, "chairSelectionPending.characterId": acceptingCharacterId },
    {
      $set: {
        chairCharacterId: acceptingCharacterId,
        chairCharacterName: character.name,
        // The mirror must flip out of technocrat mode, or every chair consumer
        // keeps resolving the caretaker NPP over the player who just accepted.
        chairMode: "character" as const,
        chairNppId: null,
        ...(seatedBoard ? { fomcBoard: seatedBoard } : {}),
        chairAppointedAt: gameNow,
        chairAppointedBy: pending.appointedByExecutiveId,
        // Scrutiny is the INSTITUTION's, not the person's: a new chair inherits
        // most of it. Zeroing it here made replacing the chair a credibility
        // laundromat — the cheapest way to erase a bad record was to churn
        // people. The retained fraction leaves a real honeymoon without making
        // the reset worth buying.
        resolveStreak: 0,
        chairTermExpiresAtTurn,
        chairSelectionPending: null,
        nominations: [],
        lobbyingPool: [],
        vacancyAwaitingAutomaticSelection: false,
        updatedAt: gameNow,
      },
      // Institutional scrutiny survives the person; the new chair inherits most
      // of it, so churning chairs is not a way to erase a bad record.
      $mul: { chairInfamy: CHAIR_CHANGE_SCRUTINY_RETAINED },
    }
  );
  if (!claimed) {
    return { ok: false, error: "No pending chair appointment" };
  }

  await createNotifications([
    {
      userId: character.userId,
      type: "system",
      title: `Appointed as ${config.centralBank.chairTitle}`,
      message: `You have taken office as the ${config.centralBank.chairTitle} of the ${config.centralBank.name}.`,
      metadata: COUNTRY_CONFIGS[countryId].centralBank.centralBankIntorgId
        ? {
            type: "central_bank_chair_appointed",
            intorgId: COUNTRY_CONFIGS[countryId].centralBank.centralBankIntorgId,
          }
        : { type: "central_bank_chair_appointed", countryId },
    },
  ]);

  notifyCbChairAcceptedDiscord(countryId, character.name).catch((err) =>
    logger.error("CentralBankChairSelection", "Discord accept failed", err)
  );

  const execOffice = config.officeTypes.find((o) => o.isExecutive);
  const executiveTitle = execOffice?.label ?? "executive";
  const executive = pending.appointedByExecutiveId
    ? await db.collection<Character>("characters").findOne({
        _id: pending.appointedByExecutiveId,
      })
    : null;
  const executiveName = executive?.name ?? "the government";

  const newsContent =
    pending.pool === "political"
      ? `${character.name}, nominated by ${executiveTitle} ${executiveName}, has been appointed to lead the ${config.centralBank.name}.`
      : `${character.name}, one of ${config.name}'s most prominent investors, ascends to lead the ${config.centralBank.name}.`;

  await createSystemNewsPost(newsContent, "election").catch((err) =>
    logger.error("CentralBankChairSelection", "Failed to create news", err)
  );

  return { ok: true };
}

/** Outcome of a refusal re-selection (decline or acceptance-window lapse). */
interface RefusalReselectionOutcome {
  ok: boolean;
  vacancy: boolean;
  /** True when the new pick came from the political pool; undefined on vacancy. */
  isPoliticalPick?: boolean;
  error?: string;
}

/**
 * Shared re-selection routine for a refused pending pick — used both when a
 * nominee actively declines and when the acceptance window lapses unanswered.
 *
 * Adds the refused nominee to the per-cycle decline list, re-runs the weighted
 * nomination draw excluding everyone who has refused this cycle, and persists
 * either a new pending pick or a vacancy. Notifications/Discord copy branch on
 * `reason`.
 *
 * The exclusion lives only on the new pending object's `declinedCharacterIds`;
 * seating a chair clears it, so a refused nominee is eligible again next cycle.
 */
async function reselectAfterRefusal(
  db: Db,
  bank: CentralBank,
  countryId: CountryId,
  pending: ChairSelectionPending,
  gameNow: Date,
  currentTurn: number,
  reason: "declined" | "timeout"
): Promise<RefusalReselectionOutcome> {
  // Atomically claim this refusal so overlapping callers (a turn-phase lapse
  // racing a real-time decline, or two turn runners overlapping on redeploy)
  // cannot both re-select and double-announce. Clearing the pending pick keyed
  // on its identity means only one caller proceeds; the loser no-ops.
  const claimed = await claimStatusTransition(
    db,
    "centralBanks",
    {
      _id: bank._id,
      "chairSelectionPending.characterId": pending.characterId,
      "chairSelectionPending.proposedAtTurn": pending.proposedAtTurn,
    },
    { $set: { chairSelectionPending: null, updatedAt: gameNow } }
  );
  if (!claimed) {
    return { ok: true, vacancy: false };
  }

  const declinedIds = [...(pending.declinedCharacterIds ?? []), pending.characterId];
  const excluded = new Set(declinedIds.map((id) => id.toString()));

  const scope = await getCentralBankScope(db, countryId);

  let next:
    | {
        candidate: PoolCandidate;
        isPoliticalPick: boolean;
        appointedByExecutiveId: ObjectId | null;
        pool: "political";
      }
    | undefined;

  const picked = await selectChairCandidate(
    db,
    bank,
    scope.memberCountries,
    excluded,
    makeSeededRng(`cbchair-redraw:${countryId}:${currentTurn}${CB_CHAIR_RNG_SALT}`)
  );
  if (picked) {
    next = {
      candidate: picked.candidate,
      isPoliticalPick: true,
      appointedByExecutiveId: picked.appointedByExecutiveId,
      pool: "political",
    };
  }

  const cfg = COUNTRY_CONFIGS[countryId];
  // Resolve the refused nominee's user for an in-app notice (best effort).
  const refusedNominee = await db
    .collection<Character>("characters")
    .findOne({ _id: pending.characterId }, { projection: { userId: 1, name: 1 } });
  if (refusedNominee?.userId) {
    const title =
      reason === "timeout"
        ? `${cfg.centralBank.chairTitle} appointment lapsed`
        : `${cfg.centralBank.chairTitle} appointment declined`;
    let message: string;
    if (reason === "timeout") {
      message = next
        ? `You did not respond within ${CHAIR_ACCEPTANCE_WINDOW_TURNS} turns, so the appointment lapsed. Another candidate has been notified.`
        : `You did not respond within ${CHAIR_ACCEPTANCE_WINDOW_TURNS} turns, so the appointment lapsed. No eligible replacement could be seated; the office remains vacant.`;
    } else {
      message = next
        ? "You declined. Another candidate has been notified and must accept."
        : "You declined. No eligible replacement could be seated at this time; the office remains vacant.";
    }
    await createNotifications([
      {
        userId: refusedNominee.userId,
        type: "system",
        title,
        message,
        metadata: { type: "central_bank_chair_declined", countryId },
      },
    ]);
  }

  notifyCbChairDeclinedDiscord(
    countryId,
    refusedNominee?.name ?? pending.characterName,
    next ? "reselected" : "vacancy",
    reason
  ).catch((err) => logger.error("CentralBankChairSelection", "Discord decline failed", err));

  if (!next) {
    await persistVacancy(db, bank._id, gameNow);
    return { ok: true, vacancy: true };
  }

  const newPending: ChairSelectionPending = {
    characterId: next.candidate.characterId,
    characterName: next.candidate.characterName,
    pool: next.pool,
    proposedAt: gameNow,
    proposedAtTurn: currentTurn,
    appointedByExecutiveId: next.appointedByExecutiveId,
    declinedCharacterIds: declinedIds,
  };

  await persistPendingProposal(db, bank, newPending, gameNow, countryId, scope.intorgId);

  return { ok: true, vacancy: false, isPoliticalPick: next.isPoliticalPick };
}

/**
 * Force a pending pick to lapse for a single bank — the timeout counterpart to
 * `declineCentralBankChairSelection`. Loads the bank, then runs the shared
 * refusal re-selection with "timeout" messaging (excludes the lapsed nominee
 * from the rest of this cycle and draws a fresh candidate, or leaves vacant).
 *
 * Used by the per-turn timeout sweep's manual-trigger tooling / admin heals; the
 * sweep itself calls `reselectAfterRefusal` directly with its already-loaded
 * bank doc to avoid a redundant fetch.
 */
export async function lapsePendingCentralBankChairSelection(
  db: Db,
  countryId: CountryId,
  gameNow: Date,
  currentTurn: number
): Promise<RefusalReselectionOutcome> {
  const bank = await db.collection<CentralBank>("centralBanks").findOne({
    _id: getBankId(countryId),
  });
  if (!bank?.chairSelectionPending) {
    return { ok: false, vacancy: false, error: "No pending chair appointment" };
  }
  return reselectAfterRefusal(
    db,
    bank,
    countryId,
    bank.chairSelectionPending,
    gameNow,
    currentTurn,
    "timeout"
  );
}

export async function declineCentralBankChairSelection(
  db: Db,
  countryId: CountryId,
  decliningCharacterId: ObjectId,
  gameNow: Date,
  currentTurn: number
): Promise<ChairDeclineResult> {
  const bank = await db.collection<CentralBank>("centralBanks").findOne({
    _id: getBankId(countryId),
  });
  if (!bank?.chairSelectionPending) return { ok: false, error: "No pending chair appointment" };

  const pending = bank.chairSelectionPending;
  if (!pending.characterId.equals(decliningCharacterId))
    return { ok: false, error: "You are not the pending nominee" };

  const decliner = await db.collection<Character>("characters").findOne({
    _id: decliningCharacterId,
    userId: { $exists: true },
  });
  if (!decliner) return { ok: false, error: "Character not found" };

  const outcome = await reselectAfterRefusal(
    db,
    bank,
    countryId,
    pending,
    gameNow,
    currentTurn,
    "declined"
  );

  return { ok: outcome.ok, vacancy: outcome.vacancy, error: outcome.error };
}
