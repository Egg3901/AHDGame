import { getDb } from "@/lib/mongodb";
import type { StateBill, State, ElectedOfficial, Character } from "@/lib/db/types";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { onBillEnacted } from "@/lib/billEnactment";
import { applyLegislationEffect } from "@/lib/legislationEffects";
import { getGameState } from "@/lib/gameState";
import type { CountryId } from "@/lib/constants/countries";
import { didPass } from "@/lib/billLifecycleHelpers";
import { resolvePhaseVotes } from "./resolvePhaseVotes";
import { REGIONAL_LIFECYCLE_CONFIG, type RegionalLifecycleConfig } from "./configs/regional";
import { validateStateBudgetImpact } from "@/lib/budget/validation";

/**
 * Regional (state) bill-lifecycle walker — the engine's `level: "regional"`
 * counterpart to `runBillLifecycle`. It is a sibling walker rather than a
 * branch of the national engine because state bills share the stage
 * VOCABULARY (chamberVote → executiveAssent → override) but none of the
 * national mechanics: they live in `stateBills` (not `bills`), have no
 * chamber fields, scope votes per-state (stateId + per-country sub-national
 * officeType), take a per-state override threshold (2/3 of that state's
 * seats), and resolve a per-state executive (seated governor, auto-enact
 * fallback). See docs/superpowers/plans/2026-07-21-unified-bill-lifecycle-
 * phase7-state.md for the decision record.
 *
 * Behavior parity contract: this module is a move + parameterize of the
 * former `src/lib/stateBillLifecycle.ts` — scoping (#0836), snapshot
 * freezing (#0982), the transient-claim revert (#2991), and all notification
 * copy are unchanged. `regionalEngine.test.ts` is the characterization guard.
 */

type DbConn = Awaited<ReturnType<typeof getDb>>;

export interface StateBillEnactmentOutcome {
  enacted: boolean;
  rejection?: {
    error: "INSUFFICIENT_FUNDS" | "DEBT_CEILING_EXCEEDED";
    costAmount: number;
    shortfall?: number;
  };
}

/**
 * State budget hard gate (audit S6). Every state enactment path funnels
 * through finalizeStateBillEnactment, so this is the single choke-point:
 * a bill the state cannot fund is transitioned to "failed" with a
 * budgetRejection record instead of enacting. Fails OPEN on validator
 * errors (an infra fault must not kill legitimate bills).
 * Returns null when the bill may enact; a rejection record otherwise.
 */
async function enforceStateBudgetGate(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>,
  bill: StateBill
): Promise<NonNullable<StateBillEnactmentOutcome["rejection"]> | null> {
  if (!bill.legislationTypeId && !bill.provisions?.length) return null;
  try {
    const validation = await validateStateBudgetImpact(
      db,
      bill.stateId,
      (bill.countryId ?? "US") as CountryId,
      bill
    );
    if (validation.allowed) return null;
    return {
      error: validation.error ?? "INSUFFICIENT_FUNDS",
      costAmount: validation.costAmount,
      ...(validation.shortfall !== undefined ? { shortfall: validation.shortfall } : {}),
    };
  } catch (err) {
    console.error("[budgetGate] state budget validation failed (failing open):", err);
    return null;
  }
}

/**
 * Apply non-policy provisions (subsidies, tariffs, …) then run the standard
 * enactment hook (policy state, refunds, notifications). Mirrors the
 * presidentialBillAction order used for national bills.
 *
 * Runs the state budget hard gate first: when the state cannot fund the bill
 * the status is flipped to "failed" (with budgetRejection recorded on the
 * bill), the sponsor is notified, and no effects are applied. Callers must
 * check `enacted` before sending "now law" notifications.
 */
export async function finalizeStateBillEnactment(
  db: DbConn,
  bill: StateBill,
  currentTurn: number
): Promise<StateBillEnactmentOutcome> {
  const rejection = await enforceStateBudgetGate(db, bill);
  if (rejection) {
    const now = new Date();
    await db.collection<StateBill>("stateBills").updateOne(
      { _id: bill._id },
      {
        $set: {
          status: "failed",
          failedAt: now,
          updatedAt: now,
          budgetRejection: { ...rejection, rejectedAt: now },
        },
      }
    );
    if (bill.sponsorId) {
      const sponsor = await db
        .collection<Character>("characters")
        .findOne({ _id: bill.sponsorId }, { projection: { _id: 1, userId: 1 } });
      if (sponsor) {
        await createNotifications([
          {
            userId: sponsor.userId,
            type: "bill_failed_chamber",
            title: "Bill Blocked: Insufficient State Funds",
            message: `"${bill.title}" passed the legislature but the state cannot fund it, so it did not become law.`,
            metadata: {
              billId: bill._id.toString(),
              stateId: bill.stateId,
              countryId: bill.countryId,
              recipientCharacterId: sponsor._id.toString(),
            },
          },
        ]);
      }
    }
    console.log(
      `[StateBill] Budget gate rejected bill ${bill._id} (${rejection.error}, shortfall ${rejection.shortfall ?? 0})`
    );
    return { enacted: false, rejection };
  }

  await applyLegislationEffect(db, {
    _id: bill._id,
    provisions: bill.provisions,
    stateId: bill.stateId,
    countryId: bill.countryId,
    legislationTypeId: bill.legislationTypeId,
    effectDirection: bill.effectDirection,
  }).catch((err) => console.error("applyLegislationEffect failed (state bill):", err));
  await onBillEnacted(db, bill, currentTurn).catch((err) =>
    console.error("Bill enactment hook failed (state bill):", err)
  );
  return { enacted: true };
}

export interface StateBillTimerResult {
  billsProcessed: number;
}

/**
 * Process state bill timers - called each turn.
 */
export async function processStateBillTimers(
  now: Date,
  config: RegionalLifecycleConfig = REGIONAL_LIFECYCLE_CONFIG
): Promise<StateBillTimerResult> {
  const db = await getDb();
  const gameStateGov = await getGameState();
  const currentTurnGov = gameStateGov?.currentTurn ?? 1;
  let billsProcessed = 0;
  const notificationInputs: NotificationInput[] = [];
  const { chamberVote, executiveAssent, override } = config.stages;

  // 1. Close voting on bills where the voting deadline has passed.
  // Use findOneAndUpdate to atomically claim each bill before processing so
  // concurrent turn runners cannot double-process the same bill (TOCTOU fix).
  // Prefer the game-clock turn deadline; fall back to date for legacy bills.
  for (;;) {
    const claimed = await db.collection<StateBill>(config.collection).findOneAndUpdate(
      {
        status: chamberVote.status,
        $or: [
          { votingEndsOnTurn: { $lte: currentTurnGov } },
          { votingEndsOnTurn: { $exists: false }, votingEndsAt: { $lte: now } },
        ],
      },
      { $set: { status: chamberVote.closingStatus, updatedAt: now } },
      { returnDocument: "before" }
    );
    if (!claimed) break;
    // Restore the original status so resolveStateBillVoting can compute
    // pass/fail against the "active" precondition correctly.
    const bill: StateBill = { ...claimed, status: chamberVote.status };
    try {
      await resolveStateBillVoting(db, config, bill, now, notificationInputs);
    } catch (err) {
      // Resolver threw mid-way — revert the transient claim so the bill is
      // re-picked next turn instead of stranding in vote_closing forever. The
      // status guard avoids clobbering a status the resolver already advanced. (#2991)
      await db
        .collection<StateBill>(config.collection)
        .updateOne(
          { _id: claimed._id, status: chamberVote.closingStatus },
          { $set: { status: chamberVote.status, updatedAt: now } }
        );
      throw err;
    }
    billsProcessed++;
  }

  // 2. Auto-sign bills where governor action deadline has passed.
  // Atomically transition status to "enacted" so no second caller can claim
  // the same bill in a concurrent turn run.
  for (;;) {
    const claimed = await db.collection<StateBill>(config.collection).findOneAndUpdate(
      {
        status: executiveAssent.status,
        $or: [
          { governorActionDeadlineOnTurn: { $lte: currentTurnGov } },
          {
            governorActionDeadlineOnTurn: { $exists: false },
            governorActionDeadline: { $lte: now },
          },
        ],
      },
      {
        $set: {
          status: executiveAssent.onTimeoutStatus,
          governorAction: "signed",
          enactedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: "before" }
    );
    if (!claimed) break;
    const autoSignOutcome = await finalizeStateBillEnactment(db, claimed, currentTurnGov);
    if (autoSignOutcome.enacted) {
      console.log(`[StateBill] Auto-signed bill ${claimed._id} (governor deadline passed)`);
    }
    billsProcessed++;
  }

  // 3. Close override voting.
  // Atomically claim each bill to prevent double-processing.
  for (;;) {
    const claimed = await db.collection<StateBill>(config.collection).findOneAndUpdate(
      {
        status: override.status,
        $or: [
          { overrideVotingEndsOnTurn: { $lte: currentTurnGov } },
          {
            overrideVotingEndsOnTurn: { $exists: false },
            overrideVotingEndsAt: { $lte: now },
          },
        ],
      },
      { $set: { status: override.closingStatus, updatedAt: now } },
      { returnDocument: "before" }
    );
    if (!claimed) break;
    const bill: StateBill = { ...claimed, status: override.status };
    try {
      await resolveOverrideVoting(db, config, bill, now, notificationInputs);
    } catch (err) {
      // Revert the transient override claim on failure so it re-resolves next
      // turn instead of stranding in override_closing. (#2991)
      await db
        .collection<StateBill>(config.collection)
        .updateOne(
          { _id: claimed._id, status: override.closingStatus },
          { $set: { status: override.status, updatedAt: now } }
        );
      throw err;
    }
    billsProcessed++;
  }

  await createNotifications(notificationInputs);
  return { billsProcessed };
}

async function resolveStateBillVoting(
  db: DbConn,
  config: RegionalLifecycleConfig,
  bill: StateBill,
  now: Date,
  notificationInputs: NotificationInput[]
): Promise<void> {
  const { chamberVote, executiveAssent } = config.stages;
  const state = await db
    .collection<State>("states")
    .findOne({ _id: bill.stateId, countryId: bill.countryId });
  const countryId = (state?.countryId ?? bill.countryId ?? "US") as CountryId;

  // Get current turn for snapshot + enactment tracking. Read BEFORE sizing the
  // chamber: `chamberSeatsFor` needs the preset for era-sized chambers (#3779).
  const gameState = await getGameState();
  const currentTurn = gameState?.currentTurn ?? 1;
  const totalSeats = state ? config.chamberSeatsFor(countryId, state, gameState?.preset) : 40;

  // Scope votes to the chamber's CURRENT seat holders before deciding pass/fail
  // (bug #0836) and freeze the result the decision used so a later sub-national
  // election cannot recompute this concluded bill's tally against a new chamber
  // (#0982). Same shared vote-core the national engine resolves through; the
  // stateId pins the roster lookup to this bill's chamber, and the stored
  // aggregate + raw map are frozen when no current-holder votes survive.
  const { totals, snapshot: voteSnapshot } = await resolvePhaseVotes(
    db,
    bill,
    {
      voteField: "votes",
      officeType: config.officeTypeFor(countryId),
      countryId,
      stateId: bill.stateId,
    },
    currentTurn
  );
  const votesFor = totals.for;
  const votesAgainst = totals.against;

  // Note: Archetype approval impacts are now applied at bill enactment,
  // not at chamber voting, so voters see effects based on policy change.

  // Tracks whether the budget gate blocked an auto-enactment below, so the
  // "your bill passed and is now law" sponsor notification is suppressed
  // (finalizeStateBillEnactment already sent the rejection notification).
  let budgetGateRejected = false;

  // Simple majority of votes CAST (For > Against), matching every national
  // legislature's `didPass` rule. Non-voting seats are NOT counted as "no": a
  // bill that wins its floor vote passes even below an absolute chamber majority
  // (bug: NIR "Services Act" won 43–28 yet failed under the old >= 46/90 rule).
  if (didPass(votesFor, votesAgainst)) {
    // Look up the regional chief executive using the country-aware office
    // key. US/UK/JP all use "governor"; DE uses "ministerPresident". Regions
    // without a seated executive (English non-London UK regions, or any
    // country/region where no official has been seeded) fall through to the
    // auto-enact path below — the bill becomes law immediately.
    const executiveOfficeKey = config.executiveOfficeKeyFor(countryId);
    const executiveTitle = config.executiveTitleFor(countryId, bill.stateId);

    const governorActionDeadline = new Date(
      now.getTime() + executiveAssent.windowHours * 3_600_000
    );

    const governor = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      officeType: executiveOfficeKey,
      state: bill.stateId,
      characterId: { $ne: null },
    });

    if (governor && governor.characterId) {
      await db.collection<StateBill>(config.collection).updateOne(
        { _id: bill._id },
        {
          $set: {
            status: chamberVote.onPassStatus,
            passedAt: now,
            sentToGovernorAt: now,
            governorActionDeadline,
            voteSnapshot,
            updatedAt: now,
          },
        }
      );

      const govChar = await db
        .collection<Character>("characters")
        .findOne({ _id: governor.characterId }, { projection: { _id: 1, userId: 1 } });
      if (govChar) {
        notificationInputs.push({
          userId: govChar.userId,
          type: "system",
          title: "Bill Awaiting Your Action",
          message: `"${bill.title}" has passed the State Senate and awaits your signature.`,
          metadata: {
            billId: bill._id.toString(),
            stateId: bill.stateId,
            countryId: bill.countryId,
            recipientCharacterId: govChar._id.toString(),
          },
        });
      }
    } else {
      // No seated executive — bill auto-enacted. Covers English non-London
      // UK regions (no devolved exec exists) and any region with a vacant
      // seat or no NPC seeded.
      await db.collection<StateBill>(config.collection).updateOne(
        { _id: bill._id },
        {
          $set: {
            status: chamberVote.onPassNoExecutiveStatus,
            passedAt: now,
            enactedAt: now,
            voteSnapshot,
            updatedAt: now,
          },
        }
      );
      const autoEnactOutcome = await finalizeStateBillEnactment(db, bill, currentTurn);
      budgetGateRejected = !autoEnactOutcome.enacted;
    }

    // Notify sponsor that bill passed
    if (bill.sponsorId && !budgetGateRejected) {
      const sponsor = await db
        .collection<Character>("characters")
        .findOne({ _id: bill.sponsorId }, { projection: { _id: 1, userId: 1 } });
      if (sponsor) {
        notificationInputs.push({
          userId: sponsor.userId,
          type: "bill_passed_chamber",
          title: "Bill Passed State Senate",
          message: `Your bill "${bill.title}" passed the State Senate${governor?.characterId ? ` and has been sent to the ${executiveTitle}.` : " and is now law."}`,
          metadata: {
            billId: bill._id.toString(),
            stateId: bill.stateId,
            countryId: bill.countryId,
            recipientCharacterId: sponsor._id.toString(),
          },
        });
      }
    }

    console.log(
      `[StateBill] Bill ${bill._id} passed (${votesFor} for / ${votesAgainst} against of ${totalSeats} seats)`
    );
  } else {
    await db.collection<StateBill>(config.collection).updateOne(
      { _id: bill._id },
      {
        $set: {
          status: chamberVote.onRejectStatus,
          failedAt: now,
          voteSnapshot,
          updatedAt: now,
        },
      }
    );

    // Notify sponsor that bill failed
    if (bill.sponsorId) {
      const sponsor = await db
        .collection<Character>("characters")
        .findOne({ _id: bill.sponsorId }, { projection: { _id: 1, userId: 1 } });
      if (sponsor) {
        notificationInputs.push({
          userId: sponsor.userId,
          type: "bill_failed_chamber",
          title: "Bill Failed",
          message: `Your bill "${bill.title}" failed to pass the State Senate (${votesFor} for, ${votesAgainst} against).`,
          metadata: {
            billId: bill._id.toString(),
            stateId: bill.stateId,
            countryId: bill.countryId,
            recipientCharacterId: sponsor._id.toString(),
          },
        });
      }
    }

    console.log(
      `[StateBill] Bill ${bill._id} failed (${votesFor} for / ${votesAgainst} against of ${totalSeats} seats)`
    );
  }
}

async function resolveOverrideVoting(
  db: DbConn,
  config: RegionalLifecycleConfig,
  bill: StateBill,
  now: Date,
  notificationInputs: NotificationInput[]
): Promise<void> {
  const { override } = config.stages;
  const state = await db
    .collection<State>("states")
    .findOne({ _id: bill.stateId, countryId: bill.countryId });
  const countryId = (state?.countryId ?? bill.countryId ?? "US") as CountryId;
  const overrideGameState = await getGameState();
  const totalSeats = state
    ? config.chamberSeatsFor(countryId, state, overrideGameState?.preset)
    : 40;
  const supermajority = Math.ceil((totalSeats * 2) / 3);

  const executiveTitle = config.executiveTitleFor(countryId, bill.stateId);

  // Scope override votes to the chamber's current seat holders before deciding
  // the override outcome (#0836) and freeze the result (#0982) — same shared
  // vote-core + faithfulness rule as the origin vote: the scoped map when
  // survivors exist, else the stored aggregate + raw override map.
  // (`overrideGameState` is read above — the chamber size needs its preset.)
  const currentTurnOverride = overrideGameState?.currentTurn ?? 1;
  const { totals: overrideTotals, snapshot: overrideVoteSnapshot } = await resolvePhaseVotes(
    db,
    bill,
    {
      voteField: "overrideVotes",
      officeType: config.officeTypeFor(countryId),
      countryId,
      stateId: bill.stateId,
    },
    currentTurnOverride
  );
  const overrideVotesFor = overrideTotals.for;

  if (overrideVotesFor >= supermajority) {
    await db.collection<StateBill>(config.collection).updateOne(
      { _id: bill._id },
      {
        $set: {
          status: override.onPassStatus,
          enactedAt: now,
          overrideVoteSnapshot,
          updatedAt: now,
        },
      }
    );
    const overrideOutcome = await finalizeStateBillEnactment(db, bill, currentTurnOverride);
    // Notify sponsor of override success (skipped when the budget gate blocked
    // enactment — the gate already notified the sponsor of the rejection).
    if (bill.sponsorId && overrideOutcome.enacted) {
      const sponsor = await db
        .collection<Character>("characters")
        .findOne({ _id: bill.sponsorId }, { projection: { userId: 1 } });
      if (sponsor) {
        notificationInputs.push({
          userId: sponsor.userId,
          type: "bill_signed",
          title: "Veto Overridden — Bill Enacted",
          message: `The ${executiveTitle}'s veto on "${bill.title}" was overridden. The bill is now law.`,
          metadata: {
            billId: bill._id.toString(),
            stateId: bill.stateId,
            countryId: bill.countryId,
            recipientCharacterId: sponsor._id.toString(),
          },
        });
      }
    }

    console.log(
      `[StateBill] Override succeeded for bill ${bill._id} (${overrideVotesFor}/${totalSeats} seats)`
    );
  } else {
    await db.collection<StateBill>(config.collection).updateOne(
      { _id: bill._id },
      {
        $set: {
          status: override.onFailStatus,
          failedAt: now,
          overrideVoteSnapshot,
          updatedAt: now,
        },
      }
    );

    // Notify sponsor of override failure
    if (bill.sponsorId) {
      const sponsor = await db
        .collection<Character>("characters")
        .findOne({ _id: bill.sponsorId }, { projection: { userId: 1 } });
      if (sponsor) {
        notificationInputs.push({
          userId: sponsor.userId,
          type: "bill_failed_chamber",
          title: "Override Failed",
          message: `The veto override for "${bill.title}" failed (${overrideVotesFor} for, needed ${supermajority}).`,
          metadata: {
            billId: bill._id.toString(),
            stateId: bill.stateId,
            countryId: bill.countryId,
            recipientCharacterId: sponsor._id.toString(),
          },
        });
      }
    }

    console.log(
      `[StateBill] Override failed for bill ${bill._id} (${overrideVotesFor}/${totalSeats} seats, needed ${supermajority})`
    );
  }
}
