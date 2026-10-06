/**
 * Unified, config-driven bill-lifecycle engine.
 *
 * A bill's lifecycle is a declarative phase graph (see ./types). Each turn, for
 * each stage in the config, the engine claims expired bills at that stage's
 * status, resolves them with the stage rule (scoping + snapshotting via the
 * shared vote-core), and advances them per the graph. Phase 1 implements the
 * three stage types US needs: chamberVote, executiveAction, override.
 */
import { ObjectId, type Db, type Filter } from "mongodb";
import type { Bill, ElectedOfficial } from "@/lib/db/types";
import { didPass, otherChamber } from "@/lib/billLifecycleHelpers";
import type { ScopedVoteOfficial } from "@/lib/congress/billVoting";
import {
  buildChamberSeatMap,
  buildOverrideDisplay,
  didVetoOverridePass,
  tallyOverrideByChamber,
  type ChamberSeatMap,
} from "@/lib/congress/vetoOverrideTally";
import { getCountryConfig, type CountryId, type GovernmentType } from "@/lib/constants/countries";
import {
  billHasDeclareWar,
  billHasNatPrivProvision,
  getBillPassRule,
  meetsBillPassRule,
} from "@/lib/congress/billPassRule";
import { buildNationalBillCountryScopeFilter } from "@/lib/legislature/nationalBillScope";
import { billRequiresExecutiveAction } from "@/lib/internationalOrganizations/withdrawalBills";
import { recordAudit } from "@/lib/audit/recordAudit";
import { applyEnactedBillEffects } from "@/lib/legislature/commands/applyEnactedBillEffects";
import { claimStatusTransition } from "@/lib/turn/atomicClaim";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { createSystemNewsPost } from "@/lib/news";
import { resolvePhaseVotes } from "./resolvePhaseVotes";
import {
  awardLawmakerAchievementForSponsor,
  didPassWithFilibusterCheck,
  notifyBillsVoteOpen,
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
import { captureBillStatusChanged } from "@/lib/analytics/billStatusAnalytics";
import { resolveRevisionDelay } from "./rules";

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

type BillStatusTransition = { bill: Bill; fromStatus: string; toStatus: string; turn: number };
const billStatusTransitions = new WeakMap<BillLifecycleResult, BillStatusTransition[]>();

const HOUR_MS = 60 * 60 * 1000;

type VoteRevisionField = "votes" | "otherChamberVotes" | "vetoOverrideVotes";

/**
 * Optimistic vote revision used by national lifecycle claims.
 *
 * National bills do not have persisted transient closing statuses. Matching
 * the exact vote maps, tallies and update timestamp makes the final status
 * transition fail when a vote or whip lands after the resolver read the bill.
 * The bill remains in its active status and is safely retried next turn with
 * the accepted vote included, instead of freezing a stale result.
 */
function voteRevisionFilter(
  bill: Bill,
  fields: readonly VoteRevisionField[]
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    updatedAt: bill.updatedAt ?? { $exists: false },
  };
  for (const field of new Set(fields)) {
    if (field === "votes") {
      filter.votes = bill.votes ?? { $exists: false };
      filter.votesFor = bill.votesFor ?? { $exists: false };
      filter.votesAgainst = bill.votesAgainst ?? { $exists: false };
      filter.votesAbstain = bill.votesAbstain ?? { $exists: false };
    } else if (field === "otherChamberVotes") {
      filter.otherChamberVotes = bill.otherChamberVotes ?? { $exists: false };
      filter.otherChamberVotesFor = bill.otherChamberVotesFor ?? { $exists: false };
      filter.otherChamberVotesAgainst = bill.otherChamberVotesAgainst ?? { $exists: false };
      filter.otherChamberVotesAbstain = bill.otherChamberVotesAbstain ?? { $exists: false };
    } else {
      filter.vetoOverrideVotes = bill.vetoOverrideVotes ?? { $exists: false };
      filter.vetoOverrideVotesFor = bill.vetoOverrideVotesFor ?? { $exists: false };
      filter.vetoOverrideVotesAgainst = bill.vetoOverrideVotesAgainst ?? { $exists: false };
    }
  }
  return filter;
}

async function loadVoteOfficials(
  db: Db,
  scopes: Array<{ countryId: string; officeType: string; voteKeys: string[] }>
): Promise<ScopedVoteOfficial[]> {
  const votersByScope = new Map<
    string,
    { countryId: string; officeType: string; characterIds: Set<string>; nppIds: Set<string> }
  >();
  for (const scope of scopes) {
    const key = `${scope.countryId}:${scope.officeType}`;
    const voters = votersByScope.get(key) ?? {
      countryId: scope.countryId,
      officeType: scope.officeType,
      characterIds: new Set<string>(),
      nppIds: new Set<string>(),
    };
    for (const voteKey of scope.voteKeys) {
      if (voteKey.startsWith("npp_") && ObjectId.isValid(voteKey.slice(4))) {
        voters.nppIds.add(voteKey.slice(4));
      } else if (ObjectId.isValid(voteKey)) {
        voters.characterIds.add(voteKey);
      }
    }
    votersByScope.set(key, voters);
  }
  const filters = [...votersByScope.values()].flatMap((scope) => {
    const voterFilters: Filter<ElectedOfficial>[] = [];
    if (scope.characterIds.size > 0) {
      voterFilters.push({
        characterId: { $in: [...scope.characterIds].map((id) => new ObjectId(id)) },
        nppId: null,
      });
    }
    if (scope.nppIds.size > 0) {
      voterFilters.push({ nppId: { $in: [...scope.nppIds].map((id) => new ObjectId(id)) } });
    }
    return voterFilters.length > 0
      ? [{ countryId: scope.countryId, officeType: scope.officeType, $or: voterFilters }]
      : [];
  });
  if (filters.length === 0) return [];
  return db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ $or: filters } as Filter<ElectedOfficial>)
    .project<ScopedVoteOfficial>({
      characterId: 1,
      countryId: 1,
      nppId: 1,
      officeType: 1,
      seatsHeld: 1,
    })
    .toArray();
}

/** Preserve recognized legacy country scopes without sharing joint ballots. */
function billCountryScope(config: BillLifecycleConfig): Record<string, unknown> {
  if (config.country === "UK") return buildNationalBillCountryScopeFilter("UK");
  if (config.country === "US")
    return {
      $or: [
        { countryId: "US" },
        { countryId: { $exists: false }, stateId: { $not: { $regex: "^uk_" } } },
        { countryId: { $type: "null" }, stateId: { $not: { $regex: "^uk_" } } },
      ],
    };
  return { countryId: config.country };
}

/** Record a successful transition into `status` (for dispatcher-derived counters). */
function recordTransition(
  result: BillLifecycleResult,
  status: string,
  bill?: Bill,
  fromStatus?: string,
  turn?: number
): void {
  result.transitionedTo[status] = (result.transitionedTo[status] ?? 0) + 1;
  if (bill && fromStatus && Number.isInteger(turn)) {
    billStatusTransitions.get(result)?.push({ bill, fromStatus, toStatus: status, turn: turn! });
  }
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
  totals: VoteTotals,
  governmentType?: GovernmentType
): Promise<boolean> {
  // Nationalize/privatize bills, and war declarations, need a two-thirds
  // supermajority of votes cast; that bar already exceeds Senate cloture, so it
  // supersedes the filibuster.
  const { rule: baseRule } = getBillPassRule(
    governmentType ?? getCountryConfig((bill.countryId ?? "US") as CountryId).governmentType,
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
  currentTurn: number,
  preset?: string,
  rng: () => number = Math.random
): Promise<BillLifecycleResult> {
  const result: BillLifecycleResult = {
    billsProcessed: 0,
    billsPassed: 0,
    billsFailed: 0,
    billsVetoed: 0,
    enactedCategories: [],
    transitionedTo: {},
  };
  billStatusTransitions.set(result, []);
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
      .find({
        $and: [billCountryScope(config)],
        status: "proposed",
        originChamber: { $in: config.originChambers },
      } as Filter<Bill>)
      .toArray();
    const voteOpenings: Array<{ bill: Bill; chamberType: string }> = [];
    for (const storedBill of proposed) {
      const bill = { ...storedBill, countryId: storedBill.countryId ?? config.country };
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
      voteOpenings.push({ bill: { ...bill, currentChamber: chamberType }, chamberType });
      recordTransition(result, "active", bill, "proposed", currentTurn);
      result.billsProcessed++;
    }
    await notifyBillsVoteOpen(db, voteOpenings);
  }

  // ── Close each chamberVote stage in graph order. ──
  for (const stage of chamberStages) {
    await closeChamberVoteStage(db, config, stage, now, currentTurn, result, rng);
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
    for (const stage of concurrentStages) {
      await closeConcurrentVoteStage(db, config, stage, now, currentTurn, result, preset);
    }
  }

  for (const transition of billStatusTransitions.get(result) ?? []) {
    await captureBillStatusChanged({
      db,
      billId: transition.bill._id.toString(),
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      scope: "national",
      chamber: transition.bill.currentChamber ?? transition.bill.originChamber,
      category: transition.bill.category,
      provisionFamily: transition.bill.provisions?.[0]?.type,
      voteMargin: transition.bill.votesFor - transition.bill.votesAgainst,
      nationId: transition.bill.countryId ?? config.country,
      turn: transition.turn,
    });
  }
  billStatusTransitions.delete(result);
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
    $and: [billCountryScope(config)],
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

  for (const storedBill of expired) {
    const bill = { ...storedBill, countryId: storedBill.countryId ?? config.country };
    const claimRevision = voteRevisionFilter(bill, ["vetoOverrideVotes"]);
    const seatData = await getSeatData(bill.countryId ?? "US");
    const tally = tallyOverrideByChamber(bill.vetoOverrideVotes, seatData);
    // Freeze the per-chamber override display so a later election cannot recompute
    // this concluded override against a new chamber composition (#0982).
    const overrideDisplaySnapshot = buildOverrideDisplay(bill.vetoOverrideVotes, seatData);

    const overridePassed = didVetoOverridePass(tally, seatData, stage.chambers);

    if (overridePassed) {
      const enacted = await claimStatusTransition(
        db,
        "bills",
        { _id: bill._id, status: stage.status, ...claimRevision },
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
        // The snapshot was just written by the claim above — the in-memory bill
        // predates it, and onBillEnacted reads it for the Discord vote chart.
        await applyEnactedBillEffects(
          db,
          { ...bill, presidentAction: "override", overrideDisplaySnapshot },
          currentTurn,
          {
            effect: "Veto override legislation effect failed (engine):",
            enactment: "Bill enactment hook failed (engine veto override):",
          }
        );
        await awardLawmakerAchievementForSponsor(bill);
        await resolveNotifier(config)(db, bill, "signed");
        if (bill.category) result.enactedCategories.push(bill.category);
        recordTransition(result, "signed", bill, stage.status, currentTurn);
        result.billsProcessed++;
        result.billsPassed++;
      }
    } else {
      const failedClaimed = await claimStatusTransition(
        db,
        "bills",
        { _id: bill._id, status: stage.status, ...claimRevision },
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
        recordTransition(result, "override_failed", bill, stage.status, currentTurn);
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
    $and: [billCountryScope(config)],
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

  for (const storedBill of expired) {
    const bill = { ...storedBill, countryId: storedBill.countryId ?? config.country };
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
    await applyEnactedBillEffects(db, bill, currentTurn, {
      effect: "Legislation effect apply failed (engine pocket-sign):",
      enactment: "Bill enactment hook failed (engine pocket-sign):",
    });
    await resolveNotifier(config)(db, bill, "signed");
    await awardLawmakerAchievementForSponsor(bill);
    if (bill.category) result.enactedCategories.push(bill.category);
    recordTransition(result, "signed", bill, stage.status, currentTurn);
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
  result: BillLifecycleResult,
  rng: () => number
): Promise<void> {
  const voteOpenings: Array<{ bill: Bill; chamberType: string }> = [];
  const onTurnField =
    stage.voteField === "otherChamberVotes" ? "otherChamberVotingEndsOnTurn" : "votingEndsOnTurn";
  const dateField =
    stage.voteField === "otherChamberVotes" ? "otherChamberVotingEndsAt" : "votingEndsAt";

  const expiredFilter: Record<string, unknown> = {
    $and: [billCountryScope(config)],
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

  const bills = expired.map((storedBill) => ({
    ...storedBill,
    countryId: storedBill.countryId ?? config.country,
  }));
  const officials = await loadVoteOfficials(
    db,
    bills.map((bill) => ({
      countryId: bill.countryId ?? "US",
      officeType: stage.officeTypeFor(bill),
      voteKeys: Object.keys(bill[stage.voteField] ?? {}),
    }))
  );

  for (const bill of bills) {
    const claimRevision = voteRevisionFilter(bill, [stage.voteField]);
    const officeType = stage.officeTypeFor(bill);
    const res = await resolvePhaseVotes(
      db,
      bill,
      {
        voteField: stage.voteField,
        officeType,
        countryId: bill.countryId ?? "US",
        officials,
      },
      currentTurn
    );
    const fields = tallyFields(stage.voteField, res);
    const passed =
      stage.passCheck?.(bill, res.totals) ??
      (await evaluatePassRule(db, bill, stage.passRule, res.totals, config.governmentType));

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
            result,
            claimRevision,
            voteOpenings
          );
          continue;
        }
      }
      const claimed = await claimStatusTransition(
        db,
        "bills",
        { _id: bill._id, status: stage.status, ...claimRevision },
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
        recordTransition(result, "failed", bill, stage.status, currentTurn);
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
          result,
          claimRevision
        );
        continue;
      }
    }

    const nextStage = config.stages.find((s) => s.status === stage.onPassStatus);
    if (nextStage?.kind === "executiveAction") {
      // UK Lords revision flavor: small chance to hold Royal Assent 1–2 turns.
      const lords = config.lordsRevisionFlavor;
      const delayTurns = lords ? resolveRevisionDelay(lords, rng) : null;
      if (delayTurns != null) {
        await enterLordsRevisionHold(
          db,
          config,
          bill,
          stage.voteField,
          fields,
          now,
          currentTurn,
          delayTurns,
          result,
          claimRevision
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
        (stage.execActionCheckOnPass &&
          !billRequiresExecutiveAction(bill, config.hasPresidentialExecutive))
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
          result,
          claimRevision
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
          result,
          claimRevision
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
        result,
        claimRevision,
        voteOpenings
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
        result,
        claimRevision
      );
    }
  }
  await notifyBillsVoteOpen(db, voteOpenings);
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
  result: BillLifecycleResult,
  claimRevision: Record<string, unknown>,
  voteOpenings: Array<{ bill: Bill; chamberType: string }>
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
    { _id: bill._id, status: passingStage.status, ...claimRevision },
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
    voteOpenings.push({ bill: { ...bill, currentChamber: nextChamber }, chamberType: nextChamber });
    // A config status string is always a real bill status.
    await resolveNotifier(config)(db, bill, targetStage.status as Bill["status"]);
    recordTransition(result, targetStage.status, bill, passingStage.status, currentTurn);
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
  result: BillLifecycleResult,
  claimRevision: Record<string, unknown>
): Promise<void> {
  const passedAtField =
    voteField === "otherChamberVotes" ? "passedOtherChamberAt" : "passedOriginAt";
  const claimed = await claimStatusTransition(
    db,
    "bills",
    { _id: bill._id, status: bill.status, ...claimRevision },
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
  recordTransition(result, "enrolled", bill, bill.status, currentTurn);
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
      billCountryScope(config),
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
  const bills = expired.map((storedBill) => ({
    ...storedBill,
    countryId: storedBill.countryId ?? config.country,
  }));
  const officials = await loadVoteOfficials(
    db,
    bills.flatMap((bill) => {
      const ctx = {
        currentChamber: bill.currentChamber ?? "",
        countryId: bill.countryId,
        preset,
      };
      return stage.chambersFor(ctx).map((officeType) => {
        const voteField = stage.voteFieldFor(ctx, officeType);
        return {
          countryId: bill.countryId ?? "US",
          officeType,
          voteKeys: Object.keys(bill[voteField] ?? {}),
        };
      });
    })
  );

  for (const bill of bills) {
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
      config.governmentType ??
        getCountryConfig((bill.countryId ?? "US") as CountryId, preset).governmentType,
      billHasNatPrivProvision(bill.provisions),
      billHasDeclareWar(bill.provisions)
    );

    const chamberOfficeTypes = stage.chambersFor(ctx);
    const voteFields = chamberOfficeTypes.map((officeType) => stage.voteFieldFor(ctx, officeType));
    const claimRevision = voteRevisionFilter(bill, voteFields);
    let fields: Record<string, unknown> = {};
    let allPassed = true;
    for (const officeType of chamberOfficeTypes) {
      const voteField = stage.voteFieldFor(ctx, officeType);
      const res = await resolvePhaseVotes(
        db,
        bill,
        { voteField, officeType, countryId: bill.countryId ?? "US", officials },
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
        { _id: bill._id, status: stage.status, ...claimRevision },
        { $set: { status: "failed", ...fields, failedAt: now, updatedAt: now } }
      );
      if (claimed) {
        await resolveNotifier(config)(db, bill, "failed");
        recordTransition(result, "failed", bill, stage.status, currentTurn);
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
    if (
      stage.execActionCheckOnPass &&
      execStage &&
      billRequiresExecutiveAction(bill, config.hasPresidentialExecutive)
    ) {
      await enterExecutive(
        db,
        bill,
        execStage,
        "votes",
        fields,
        now,
        currentTurn,
        result,
        claimRevision
      );
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
      result,
      claimRevision
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
  result: BillLifecycleResult,
  claimRevision: Record<string, unknown>
): Promise<void> {
  const passedAtField =
    voteField === "otherChamberVotes" ? "passedOtherChamberAt" : "passedOriginAt";
  const claimed = await claimStatusTransition(
    db,
    "bills",
    { _id: bill._id, status: bill.status, ...claimRevision },
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
    recordTransition(result, "enrolled", bill, bill.status, currentTurn);
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
  result: BillLifecycleResult,
  claimRevision: Record<string, unknown>
): Promise<void> {
  const passedAtField =
    voteField === "otherChamberVotes" ? "passedOtherChamberAt" : "passedOriginAt";
  const claimed = await claimStatusTransition(
    db,
    "bills",
    { _id: bill._id, status: fromStatus, ...claimRevision },
    { $set: { status: "signed", ...fields, [passedAtField]: now, enactedAt: now, updatedAt: now } }
  );
  if (!claimed) return;
  // `fields` carries this chamber's fresh tally + vote snapshot, which the
  // in-memory bill predates — onBillEnacted reads them for the vote chart.
  await applyEnactedBillEffects(db, { ...bill, ...(fields as Partial<Bill>) }, currentTurn, {
    effect: "Legislation effect apply failed (engine signed):",
    enactment: "Bill enactment hook failed (engine signed):",
  });
  await resolveNotifier(config)(db, bill, "signed");
  await awardLawmakerAchievementForSponsor(bill);
  if (bill.category) result.enactedCategories.push(bill.category);
  recordTransition(result, "signed", bill, fromStatus, currentTurn);
  result.billsProcessed++;
  result.billsPassed++;
}
