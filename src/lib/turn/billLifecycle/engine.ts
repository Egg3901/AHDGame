/**
 * Unified, config-driven bill-lifecycle engine.
 *
 * A bill's lifecycle is a declarative phase graph (see ./types). Each turn, for
 * each stage in the config, the engine claims expired bills at that stage's
 * status, resolves them with the stage rule (scoping + snapshotting via the
 * shared vote-core), and advances them per the graph. Phase 1 implements the
 * three stage types US needs: chamberVote, executiveAction, override.
 */
import { type Db, type Filter } from "mongodb";
import type { Bill, ElectedOfficial, GameState } from "@/lib/db/types";
import { didPass, otherChamber } from "@/lib/billLifecycleHelpers";
import type { ScopedVoteOfficial } from "@/lib/congress/billVoting";
import {
  buildChamberSeatMap,
  buildOverrideDisplay,
  tallyOverrideByChamber,
  type ChamberSeatMap,
} from "@/lib/congress/vetoOverrideTally";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import {
  billHasDeclareWar,
  billHasNatPrivProvision,
  getBillPassRule,
  meetsBillPassRule,
} from "@/lib/congress/billPassRule";
import { billRequiresExecutiveAction } from "@/lib/internationalOrganizations/withdrawalBills";
import { recordAudit } from "@/lib/audit/recordAudit";
import { applyLegislationEffect } from "@/lib/legislationEffects";
import { onBillEnacted } from "@/lib/billEnactment";
import { claimStatusTransition } from "@/lib/turn/atomicClaim";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { createSystemNewsPost } from "@/lib/news";
import { resolvePhaseVotes } from "./resolvePhaseVotes";
import {
  awardLawmakerAchievementForSponsor,
  didPassWithFilibusterCheck,
  notifyChambersVoteOpen,
  notifyPresidentBillAwaitingSignature,
  notifySponsor as defaultNotifySponsor,
} from "./lifecycleHelpers";
import type {
  BillLifecycleConfig,
  ChamberVoteStage,
  ConcurrentVoteStage,
  ExecutiveActionStage,
  OverrideStage,
  PassRule,
  PhaseVoteResult,
  SponsorNotifier,
  VoteTotals,
} from "./types";

export interface BillLifecycleResult {
  billsProcessed: number;
  billsPassed: number;
  billsFailed: number;
  billsVetoed: number;
  /** `category` of every bill enacted this run — consumed by regime-drift ticks. */
  enactedCategories: string[];
  /** Count of bills transitioned INTO each status — bespoke dispatchers (JP) derive counters. */
  transitionedTo: Record<string, number>;
}

const HOUR_MS = 60 * 60 * 1000;

/** Record a successful transition into `status` (for dispatcher-derived counters). */
function recordTransition(result: BillLifecycleResult, status: string): void {
  result.transitionedTo[status] = (result.transitionedTo[status] ?? 0) + 1;
}

/** Resolve the sponsor notifier for a config (per-country override or the US default). */
function resolveNotifier(config: BillLifecycleConfig): SponsorNotifier {
  return config.notifySponsor ?? defaultNotifySponsor;
}

/** Fixed evaluator per passRule name — preserves the US rule nuance exactly. */
async function evaluatePassRule(
  db: Db,
  bill: Bill,
  rule: PassRule,
  totals: VoteTotals
): Promise<boolean> {
  // Nationalize/privatize bills, and war declarations, need a two-thirds
  // supermajority of votes cast; that bar already exceeds Senate cloture, so it
  // supersedes the filibuster.
  const { rule: baseRule } = getBillPassRule(
    getCountryConfig((bill.countryId ?? "US") as CountryId).governmentType,
    billHasNatPrivProvision(bill.provisions),
    billHasDeclareWar(bill.provisions)
  );
  if (baseRule === "twoThirds") return meetsBillPassRule(totals.for, totals.against, "twoThirds");
  if (rule === "twoThirdsCast") return meetsBillPassRule(totals.for, totals.against, "twoThirds");
  if (
    rule === "filibusterCloture" &&
    bill.currentChamber === "senate" &&
    bill.filibusterInvocations?.length
  ) {
    return didPassWithFilibusterCheck(db, bill, totals.for, totals.against, totals.abstain);
  }
  return didPass(totals.for, totals.against);
}

/** Tally $set fields for the origin (`votes`) or second (`otherChamberVotes`) chamber. */
function tallyFields(
  voteField: "votes" | "otherChamberVotes",
  res: PhaseVoteResult
): Record<string, unknown> {
  return voteField === "otherChamberVotes"
    ? {
        otherChamberVotesFor: res.totals.for,
        otherChamberVotesAgainst: res.totals.against,
        otherChamberVotesAbstain: res.totals.abstain,
        otherChamberVoteSnapshot: res.snapshot,
      }
    : {
        votesFor: res.totals.for,
        votesAgainst: res.totals.against,
        votesAbstain: res.totals.abstain,
        voteSnapshot: res.snapshot,
      };
}

export async function runBillLifecycle(
  db: Db,
  config: BillLifecycleConfig,
  now: Date,
  currentTurn: number
): Promise<BillLifecycleResult> {
  const result: BillLifecycleResult = {
    billsProcessed: 0,
    billsPassed: 0,
    billsFailed: 0,
    billsVetoed: 0,
    enactedCategories: [],
    transitionedTo: {},
  };
  // Legislation freeze: skip the whole phase while this country's government is
  // still forming (e.g. UK S#17 — no bills resolve during a pending government).
  if (config.skipWhenGovPending) {
    const gov = await getGovernmentFormationsCollection(db).findOne({ _id: config.country });
    if (gov?.status === "pending") return result;
  }

  const chamberStages = config.stages.filter(
    (s): s is ChamberVoteStage => s.kind === "chamberVote"
  );
  const firstChamber = chamberStages[0];

  // ── A. Activate lingering "proposed" bills into the first chamber stage. ──
  // Opt-in per config: US does this as a safety net; UK/others never had it.
  if (config.activateProposed && firstChamber) {
    const proposed = await db
      .collection<Bill>("bills")
      .find({ status: "proposed", originChamber: { $in: config.originChambers } })
      .toArray();
    for (const bill of proposed) {
      const chamberType = firstChamber.officeTypeFor(bill);
      // Activation is a plain update (matches the legacy processor); the atomic
      // claim guards the vote-closing transitions, not this idempotent step.
      await db.collection<Bill>("bills").updateOne(
        { _id: bill._id },
        {
          $set: {
            status: "active",
            currentChamber: chamberType,
            votingStartedAt: now,
            votingEndsAt: new Date(now.getTime() + firstChamber.votingDurationHours * HOUR_MS),
            votingEndsOnTurn: currentTurn + firstChamber.votingDurationHours,
            updatedAt: now,
          },
        }
      );
      await notifyChambersVoteOpen(db, { ...bill, currentChamber: chamberType }, chamberType);
      recordTransition(result, "active");
      result.billsProcessed++;
    }
  }

  // ── Close each chamberVote stage in graph order. ──
  for (const stage of chamberStages) {
    await closeChamberVoteStage(db, config, stage, now, currentTurn, result);
  }

  // ── Expire executiveAction windows (pocket-sign on timeout). ──
  for (const stage of config.stages) {
    if (stage.kind === "executiveAction" && stage.windowHours > 0) {
      await closeExecutiveStage(db, config, stage, now, currentTurn, result);
    }
  }

  // ── Resolve expired override votes. ──
  for (const stage of config.stages) {
    if (stage.kind === "override") {
      await closeOverrideStage(db, config, stage, now, currentTurn, result);
    }
  }

  // ── Close concurrent bicameral votes. ──
  // A stage kind with no dispatch is silently never closed: the bill sits at its status
  // forever and no tally assertion catches it.
  const concurrentStages = config.stages.filter(
    (s): s is ConcurrentVoteStage => s.kind === "concurrentVote"
  );
  if (concurrentStages.length > 0) {
    // Legislature shape is preset-dependent (DE 1953 flips `bicameral`; TR/ES flip
    // `upperElectionSystem`), and these stages resolve chamber counts. Read once per run,
    // and only when a concurrent stage exists so quiet configs pay nothing.
    const gsForPreset = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } });
    const preset = typeof gsForPreset?.preset === "string" ? gsForPreset.preset : undefined;
    for (const stage of concurrentStages) {
      await closeConcurrentVoteStage(db, config, stage, now, currentTurn, result, preset);
    }
  }

  return result;
}

async function closeOverrideStage(
  db: Db,
  config: BillLifecycleConfig,
  stage: OverrideStage,
  now: Date,
  currentTurn: number,
  result: BillLifecycleResult
): Promise<void> {
  const expiredFilter: Record<string, unknown> = {
    status: stage.status,
    $or: [
      { overrideVotingEndsOnTurn: { $lte: currentTurn } },
      { overrideVotingEndsOnTurn: { $exists: false }, overrideVotingEndsAt: { $lte: now } },
    ],
    originChamber: { $in: config.originChambers },
  };
  const expired = await db
    .collection<Bill>("bills")
    .find(expiredFilter as Filter<Bill>)
    .toArray();
  if (expired.length === 0) return;

  // Per-country seat map, cached — 2/3 of the SEATS in each chamber (#0952),
  // seat-weighted so multi-seat officials count correctly.
  const seatByCountry = new Map<string, ChamberSeatMap>();
  const getSeatData = async (countryId: string): Promise<ChamberSeatMap> => {
    let data = seatByCountry.get(countryId);
    if (!data) {
      const seatFilter: Record<string, unknown> = {
        officeType: { $in: stage.chambers },
        countryId,
      };
      const officials = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find(seatFilter as Filter<ElectedOfficial>)
        .project<ScopedVoteOfficial>({
          characterId: 1,
          countryId: 1,
          nppId: 1,
          officeType: 1,
          seatsHeld: 1,
        })
        .toArray();
      data = buildChamberSeatMap(officials);
      seatByCountry.set(countryId, data);
    }
    return data;
  };

  for (const bill of expired) {
    const seatData = await getSeatData(bill.countryId ?? "US");
    const tally = tallyOverrideByChamber(bill.vetoOverrideVotes, seatData);
    // Freeze the per-chamber override display so a later election cannot recompute
    // this concluded override against a new chamber composition (#0982).
    const overrideDisplaySnapshot = buildOverrideDisplay(bill.vetoOverrideVotes, seatData);

    const seatsByChamber: Record<string, number> = {
      house: seatData.houseSeats,
      senate: seatData.senateSeats,
    };
    const forByChamber: Record<string, number> = {
      house: tally.houseFor,
      senate: tally.senateFor,
    };
    const overridePassed = stage.chambers.every(
      (ch) => (forByChamber[ch] ?? 0) >= Math.ceil((2 / 3) * (seatsByChamber[ch] ?? 0))
    );

    if (overridePassed) {
      const enacted = await claimStatusTransition(
        db,
        "bills",
        { _id: bill._id, status: stage.status },
        {
          $set: {
            status: "signed",
            presidentAction: "override",
            enactedAt: now,
            overrideEnactedAt: now,
            overrideDisplaySnapshot,
            updatedAt: now,
          },
        }
      );
      if (enacted) {
        await applyLegislationEffect(db, bill).catch((err) =>
          console.error("Veto override legislation effect failed (engine):", err)
        );
        await onBillEnacted(db, bill, currentTurn).catch((err) =>
          console.error("Bill enactment hook failed (engine veto override):", err)
        );
        await awardLawmakerAchievementForSponsor(bill);
        await resolveNotifier(config)(db, bill, "signed");
        if (bill.category) result.enactedCategories.push(bill.category);
        recordTransition(result, "signed");
        result.billsProcessed++;
        result.billsPassed++;
      }
    } else {
      const failedClaimed = await claimStatusTransition(
        db,
        "bills",
        { _id: bill._id, status: stage.status },
        {
          $set: {
            status: "override_failed",
            overrideFailedAt: now,
            overrideDisplaySnapshot,
            updatedAt: now,
          },
        }
      );
      if (failedClaimed) {
        // Forensic audit trail (flag-gated, fire-and-forget) — legacy US envelope
        // shape; houseFor/senateFor stay named for the US chambers' tally keys.
        recordAudit({
          source: "turn",
          phase: "billLifecycle",
          action: "bill.fail",
          category: "governance",
          subject: { type: "bill", id: bill._id.toString(), name: bill.title },
          refs: { billId: bill._id },
          meta: { chamber: "veto_override", houseFor: tally.houseFor, senateFor: tally.senateFor },
          outcome: "ok",
        });
        await resolveNotifier(config)(db, bill, "failed");
        recordTransition(result, "override_failed");
        result.billsProcessed++;
        result.billsFailed++;
      }
    }
  }
}

async function closeExecutiveStage(
  db: Db,
  config: BillLifecycleConfig,
  stage: ExecutiveActionStage,
  now: Date,
  currentTurn: number,
  result: BillLifecycleResult
): Promise<void> {
  // The active sign/veto is driven by the executive-action API endpoint; the
  // engine only handles the deadline expiring — pocket-sign into law.
  const expiredFilter: Record<string, unknown> = {
    status: stage.status,
    $or: [
      { presidentActionDeadlineOnTurn: { $lte: currentTurn } },
      {
        presidentActionDeadlineOnTurn: { $exists: false },
        presidentActionDeadline: { $lte: now },
      },
    ],
    originChamber: { $in: config.originChambers },
  };
  const expired = await db
    .collection<Bill>("bills")
    .find(expiredFilter as Filter<Bill>)
    .toArray();

  for (const bill of expired) {
    const enacted = await claimStatusTransition(
      db,
      "bills",
      { _id: bill._id, status: stage.status },
      {
        $set: {
          status: "signed",
          presidentAction: "unsigned_law",
          enactedAt: now,
          updatedAt: now,
        },
      }
    );
    if (!enacted) continue;
    await applyLegislationEffect(db, bill).catch((err) =>
      console.error("Legislation effect apply failed (engine pocket-sign):", err)
    );
    await onBillEnacted(db, bill, currentTurn).catch((err) =>
      console.error("Bill enactment hook failed (engine pocket-sign):", err)
    );
    await resolveNotifier(config)(db, bill, "signed");
    await awardLawmakerAchievementForSponsor(bill);
    if (bill.category) result.enactedCategories.push(bill.category);
    recordTransition(result, "signed");
    result.billsProcessed++;
    result.billsPassed++;
  }
}

async function closeChamberVoteStage(
  db: Db,
  config: BillLifecycleConfig,
  stage: ChamberVoteStage,
  now: Date,
  currentTurn: number,
  result: BillLifecycleResult
): Promise<void> {
  const onTurnField =
    stage.voteField === "otherChamberVotes" ? "otherChamberVotingEndsOnTurn" : "votingEndsOnTurn";
  const dateField =
    stage.voteField === "otherChamberVotes" ? "otherChamberVotingEndsAt" : "votingEndsAt";

  const expiredFilter: Record<string, unknown> = {
    status: stage.status,
    $or: [
      { [onTurnField]: { $lte: currentTurn } },
      { [onTurnField]: { $exists: false }, [dateField]: { $lte: now } },
    ],
    originChamber: { $in: config.originChambers },
  };
  const expired = await db
    .collection<Bill>("bills")
    .find(expiredFilter as Filter<Bill>)
    .toArray();

  for (const claimedBill of expired) {
    const bill =
      (await db.collection<Bill>("bills").findOne({ _id: claimedBill._id })) ?? claimedBill;
    const officeType = stage.officeTypeFor(bill);
    const res = await resolvePhaseVotes(
      db,
      bill,
      { voteField: stage.voteField, officeType, countryId: bill.countryId ?? "US" },
      currentTurn
    );
    const fields = tallyFields(stage.voteField, res);
    const passed = await evaluatePassRule(db, bill, stage.passRule, res.totals);

    if (!passed) {
      // Bill-dependent reject routing (JP Sangiin: sangiin-origin fails; else the
      // Shūgiin gets a 2/3 override). Absent onRejectFn, reject always fails.
      const rejectOutcome = stage.onRejectFn ? stage.onRejectFn(bill) : stage.onReject;
      if (typeof rejectOutcome === "object" && rejectOutcome.toStatus) {
        const targetStage = config.stages.find((s) => s.status === rejectOutcome.toStatus);
        if (targetStage?.kind === "chamberVote") {
          await enterChamberVoteStage(
            db,
            config,
            stage,
            targetStage,
            bill,
            fields,
            now,
            currentTurn,
            result
          );
          continue;
        }
      }
      const claimed = await claimStatusTransition(
        db,
        "bills",
        { _id: bill._id, status: stage.status },
        { $set: { status: "failed", ...fields, failedAt: now, updatedAt: now } }
      );
      if (claimed) {
        // Forensic audit trail (flag-gated, fire-and-forget) — mirrors the legacy
        // US resolver's bill.fail envelopes; the engine records for every country.
        recordAudit({
          source: "turn",
          phase: "billLifecycle",
          action: "bill.fail",
          category: "governance",
          subject: { type: "bill", id: bill._id.toString(), name: bill.title },
          refs: { billId: bill._id },
          meta: {
            chamber: stage.voteField === "otherChamberVotes" ? "other" : "origin",
            votesFor: res.totals.for,
            votesAgainst: res.totals.against,
          },
          outcome: "ok",
        });
        await resolveNotifier(config)(db, bill, "failed");
        recordTransition(result, "failed");
        result.billsProcessed++;
        result.billsFailed++;
      }
      continue;
    }

    // Passed — resolve the target of this transition.
    // Joint bills skip the second chamber and go straight to the executive stage,
    // regardless of this stage's onPassStatus (which points at the second chamber).
    const isJointShortCircuit =
      config.flags?.jointSkipsSecondChamber &&
      bill.originChamber === "joint" &&
      stage.voteField === "votes";
    if (isJointShortCircuit) {
      const jointExec = config.stages.find(
        (s): s is ExecutiveActionStage => s.kind === "executiveAction"
      );
      if (jointExec) {
        await enterExecutive(
          db,
          bill,
          jointExec,
          stage.voteField,
          fields,
          now,
          currentTurn,
          result
        );
        continue;
      }
    }

    const nextStage = config.stages.find((s) => s.status === stage.onPassStatus);
    if (nextStage?.kind === "executiveAction") {
      // UK Lords revision flavor: small chance to hold Royal Assent 1–2 turns.
      const lords = config.lordsRevisionFlavor;
      if (lords && lords.chance > 0 && Math.random() < lords.chance) {
        const span = Math.max(0, lords.delayTurnsMax - lords.delayTurnsMin);
        const delayTurns = lords.delayTurnsMin + (span > 0 && Math.random() >= 0.5 ? span : 0);
        await enterLordsRevisionHold(
          db,
          config,
          bill,
          stage.voteField,
          fields,
          now,
          currentTurn,
          Math.max(1, delayTurns),
          result
        );
        continue;
      }
      // Zero-window assent (e.g. UK Royal Assent) enacts immediately; a real
      // action window (US President) enters the window; intl-org bills that
      // don't require executive action are signed directly.
      // UK with lordsRevisionFlavor that missed the roll also enacts immediately
      // even though windowHours > 0 (the window exists only for delayed bills).
      if (
        nextStage.windowHours === 0 ||
        config.lordsRevisionFlavor != null ||
        (stage.execActionCheckOnPass && !billRequiresExecutiveAction(bill))
      ) {
        await enterSigned(
          db,
          config,
          bill,
          stage.status,
          stage.voteField,
          fields,
          now,
          currentTurn,
          result
        );
      } else {
        await enterExecutive(
          db,
          bill,
          nextStage,
          stage.voteField,
          fields,
          now,
          currentTurn,
          result
        );
      }
    } else if (nextStage?.kind === "chamberVote") {
      // Next stage is another chamber vote — advance into it (reset its votes).
      await enterChamberVoteStage(
        db,
        config,
        stage,
        nextStage,
        bill,
        fields,
        now,
        currentTurn,
        result
      );
    } else {
      // Terminal pass (no next stage) — enact directly (e.g. UK single chamber).
      await enterSigned(
        db,
        config,
        bill,
        stage.status,
        stage.voteField,
        fields,
        now,
        currentTurn,
        result
      );
    }
  }
}

/**
 * Advance a passing bill INTO another chamberVote stage: set the new
 * currentChamber, reset the target stage's vote field + voting window, and (only
 * when the target reuses a DIFFERENT vote field) freeze the passing stage's
 * result via `fields`. A same-field re-entry (JP cabinet→active, reject→override)
 * starts a genuinely fresh vote, so the passing result is not carried.
 */
async function enterChamberVoteStage(
  db: Db,
  config: BillLifecycleConfig,
  passingStage: ChamberVoteStage,
  targetStage: ChamberVoteStage,
  bill: Bill,
  fields: Record<string, unknown>,
  now: Date,
  currentTurn: number,
  result: BillLifecycleResult
): Promise<void> {
  const nextChamber =
    targetStage.chamberOnEnter?.(bill) ?? otherChamber(bill.originChamber as "house" | "senate");
  const hours = targetStage.votingDurationHours;
  const carry = passingStage.voteField !== targetStage.voteField ? fields : {};
  const windowReset: Record<string, unknown> =
    targetStage.voteField === "otherChamberVotes"
      ? {
          passedOriginAt: now,
          sentToOtherChamberAt: now,
          otherChamberVotingStartedAt: now,
          otherChamberVotingEndsAt: new Date(now.getTime() + hours * HOUR_MS),
          otherChamberVotingEndsOnTurn: currentTurn + hours,
          otherChamberVotesFor: 0,
          otherChamberVotesAgainst: 0,
          otherChamberVotesAbstain: 0,
          otherChamberVotes: {},
        }
      : {
          votingStartedAt: now,
          votingEndsAt: new Date(now.getTime() + hours * HOUR_MS),
          votingEndsOnTurn: currentTurn + hours,
          votesFor: 0,
          votesAgainst: 0,
          votesAbstain: 0,
          votes: {},
        };
  const claimed = await claimStatusTransition(
    db,
    "bills",
    { _id: bill._id, status: passingStage.status },
    {
      $set: {
        status: targetStage.status,
        currentChamber: nextChamber,
        ...carry,
        ...windowReset,
        updatedAt: now,
      },
      // Fresh vote phase: drop the player-whip "whipped from" trail so the UI
      // doesn't show a stale revert badge from the prior vote (JP override).
      ...(targetStage.clearWhippedFrom ? { $unset: { whippedFromVote: "" } } : {}),
    }
  );
  if (claimed) {
    await targetStage.onEnterHook?.(db, bill);
    await notifyChambersVoteOpen(db, { ...bill, currentChamber: nextChamber }, nextChamber);
    // A config status string is always a real bill status.
    await resolveNotifier(config)(db, bill, targetStage.status as Bill["status"]);
    recordTransition(result, targetStage.status);
    result.billsProcessed++;
    result.billsPassed++;
  }
}

/**
 * UK Lords revision hold — bill sits in `enrolled` with chamber "lords" for
 * 1–2 turns (wire + sponsor ping only; no Lords seats). closeExecutiveStage
 * pocket-enacts when the deadline turn arrives.
 */
async function enterLordsRevisionHold(
  db: Db,
  config: BillLifecycleConfig,
  bill: Bill,
  voteField: "votes" | "otherChamberVotes",
  fields: Record<string, unknown>,
  now: Date,
  currentTurn: number,
  delayTurns: number,
  result: BillLifecycleResult
): Promise<void> {
  const passedAtField =
    voteField === "otherChamberVotes" ? "passedOtherChamberAt" : "passedOriginAt";
  const claimed = await claimStatusTransition(
    db,
    "bills",
    { _id: bill._id, status: bill.status },
    {
      $set: {
        status: "enrolled",
        currentChamber: "lords",
        ...fields,
        [passedAtField]: now,
        sentToPresidentAt: now,
        presidentActionDeadline: new Date(now.getTime() + delayTurns * HOUR_MS),
        presidentActionDeadlineOnTurn: currentTurn + delayTurns,
        updatedAt: now,
      },
    }
  );
  if (!claimed) return;

  await resolveNotifier(config)(db, bill, "enrolled");
  recordTransition(result, "enrolled");
  result.billsProcessed++;
  result.billsPassed++;

  try {
    await createSystemNewsPost(
      `"${bill.title}" has cleared the Commons and faces a short Lords revision before Royal Assent — a procedural ping-pong, not a second elected chamber.`,
      "legislation",
      { title: "Lords Revision Holds Bill" }
    );
  } catch {
    // Wire is best-effort.
  }
}

/**
 * Close a concurrent bicameral vote.
 *
 * Lives here rather than in its own module because it reuses `tallyFields`,
 * `enterSigned` and `enterExecutive`, and splitting it out would either duplicate them
 * or create a circular import.
 */
async function closeConcurrentVoteStage(
  db: Db,
  config: BillLifecycleConfig,
  stage: ConcurrentVoteStage,
  now: Date,
  currentTurn: number,
  result: BillLifecycleResult,
  preset?: string
): Promise<void> {
  // The CLOSE filter ANDs the deadline pairs — a bill must not close while a chamber is
  // still voting. (The NPP FETCH filter ORs them: poll while EITHER is open.)
  const expiredFilter: Record<string, unknown> = {
    status: stage.status,
    $and: [
      {
        $or: [
          { votingEndsOnTurn: { $lte: currentTurn } },
          { votingEndsOnTurn: { $exists: false }, votingEndsAt: { $lte: now } },
        ],
      },
      {
        $or: [
          { otherChamberVotingEndsOnTurn: { $lte: currentTurn } },
          {
            otherChamberVotingEndsOnTurn: { $exists: false },
            otherChamberVotingEndsAt: { $lte: now },
          },
        ],
      },
    ],
    originChamber: { $in: config.originChambers },
  };

  const expired = await db
    .collection<Bill>("bills")
    .find(expiredFilter as Filter<Bill>)
    .toArray();

  for (const claimedBill of expired) {
    const bill =
      (await db.collection<Bill>("bills").findOne({ _id: claimedBill._id })) ?? claimedBill;
    const ctx = {
      currentChamber: bill.currentChamber ?? "",
      countryId: bill.countryId,
      preset,
    };

    // Resolved PER BILL, not taken from the stage alone: nat/priv supersedes to
    // two-thirds and is provision-driven. `evaluatePassRule` is deliberately NOT reused
    // — it bundles Senate cloture, which a concurrent bill never faces (the filibuster
    // route refuses these outright).
    const { rule } = getBillPassRule(
      getCountryConfig((bill.countryId ?? "US") as CountryId, preset).governmentType,
      billHasNatPrivProvision(bill.provisions),
      billHasDeclareWar(bill.provisions)
    );

    let fields: Record<string, unknown> = {};
    let allPassed = true;
    for (const officeType of stage.chambersFor(ctx)) {
      const voteField = stage.voteFieldFor(ctx, officeType);
      const res = await resolvePhaseVotes(
        db,
        bill,
        { voteField, officeType, countryId: bill.countryId ?? "US" },
        currentTurn
      );
      // `tallyFields` is parameterised by voteField, so calling it per chamber gives
      // each its own totals AND its own frozen snapshot (#0982).
      fields = { ...fields, ...tallyFields(voteField, res) };
      if (!meetsBillPassRule(res.totals.for, res.totals.against, rule)) allPassed = false;
    }

    if (!allPassed) {
      const claimed = await claimStatusTransition(
        db,
        "bills",
        { _id: bill._id, status: stage.status },
        { $set: { status: "failed", ...fields, failedAt: now, updatedAt: now } }
      );
      if (claimed) {
        await resolveNotifier(config)(db, bill, "failed");
        recordTransition(result, "failed");
        result.billsProcessed++;
        result.billsFailed++;
      }
      continue;
    }

    // Passed. Reproduce the DISPATCH only — `enterSigned` already contains
    // applyLegislationEffect, onBillEnacted, the notifier, the achievement award,
    // recordTransition and the counters. Calling any of those alongside it double-enacts.
    const execStage = config.stages.find(
      (s): s is ExecutiveActionStage => s.kind === "executiveAction"
    );
    if (stage.execActionCheckOnPass && execStage && billRequiresExecutiveAction(bill)) {
      await enterExecutive(db, bill, execStage, "votes", fields, now, currentTurn, result);
      continue;
    }
    // A concurrent close has TWO passage moments. `enterSigned` spreads `...fields`
    // before `[passedAtField]`, so putting the other chamber's stamp in `fields` lets it
    // set `passedOriginAt` itself — no signature change.
    await enterSigned(
      db,
      config,
      bill,
      stage.status,
      "votes",
      { ...fields, passedOtherChamberAt: now },
      now,
      currentTurn,
      result
    );
  }
}

async function enterExecutive(
  db: Db,
  bill: Bill,
  execStage: ExecutiveActionStage,
  voteField: "votes" | "otherChamberVotes",
  fields: Record<string, unknown>,
  now: Date,
  currentTurn: number,
  result: BillLifecycleResult
): Promise<void> {
  const passedAtField =
    voteField === "otherChamberVotes" ? "passedOtherChamberAt" : "passedOriginAt";
  const claimed = await claimStatusTransition(
    db,
    "bills",
    { _id: bill._id, status: bill.status },
    {
      $set: {
        status: "enrolled",
        ...fields,
        [passedAtField]: now,
        sentToPresidentAt: now,
        presidentActionDeadline: new Date(now.getTime() + execStage.windowHours * HOUR_MS),
        presidentActionDeadlineOnTurn: currentTurn + execStage.windowHours,
        updatedAt: now,
      },
    }
  );
  if (claimed) {
    // enterExecutive (enrolled → President) is a US-only path; the US default
    // notifier applies. Parliamentary countries enact via enterSigned instead.
    await defaultNotifySponsor(db, bill, "enrolled");
    await notifyPresidentBillAwaitingSignature(db, bill);
    recordTransition(result, "enrolled");
    result.billsProcessed++;
    result.billsPassed++;
  }
}

async function enterSigned(
  db: Db,
  config: BillLifecycleConfig,
  bill: Bill,
  fromStatus: string,
  voteField: "votes" | "otherChamberVotes",
  fields: Record<string, unknown>,
  now: Date,
  currentTurn: number,
  result: BillLifecycleResult
): Promise<void> {
  const passedAtField =
    voteField === "otherChamberVotes" ? "passedOtherChamberAt" : "passedOriginAt";
  const claimed = await claimStatusTransition(
    db,
    "bills",
    { _id: bill._id, status: fromStatus },
    { $set: { status: "signed", ...fields, [passedAtField]: now, enactedAt: now, updatedAt: now } }
  );
  if (!claimed) return;
  await applyLegislationEffect(db, bill).catch((err) =>
    console.error("Legislation effect apply failed (engine signed):", err)
  );
  await onBillEnacted(db, bill, currentTurn).catch((err) =>
    console.error("Bill enactment hook failed (engine signed):", err)
  );
  await resolveNotifier(config)(db, bill, "signed");
  await awardLawmakerAchievementForSponsor(bill);
  if (bill.category) result.enactedCategories.push(bill.category);
  recordTransition(result, "signed");
  result.billsProcessed++;
  result.billsPassed++;
}
