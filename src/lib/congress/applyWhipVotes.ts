/**
 * Immediately apply whip-influenced NPP votes to bills, leadership
 * elections, and confidence votes. Called from both national and state
 * party whip routes so that NPP votes are cast at whip-issuance time
 * rather than waiting for the next turn.
 */

import type { Db } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { resolveBillVoteField } from "@/lib/congress/billVoteField";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import type { CountryId } from "@/lib/constants/countries";
import type {
  Bill,
  CabinetNomination,
  ElectedOfficial,
  LegislationType,
  NPP,
  NPPVotePrediction,
  SpeakerNomination,
  SpeakerVacateMotion,
  StateBill,
  StateDemographics,
} from "@/lib/db/types";
import {
  loadVacateSpeakerContext,
  nppStance,
  nppVacateMotionVote,
} from "@/lib/congress/speaker/nppVacateVote";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { computeCrossPressureForces, verdictFromForces } from "@/lib/turn/npp/crossPressure";
import {
  getGovernmentFormationsCollection,
  getPMAppointmentVotesCollection,
  getNoConfidenceVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import { castLeadershipVote } from "@/lib/turn/npp/leadershipVoting";
import { resolveNppWhipSuccess, type NppWhipMode } from "@/lib/partyWhips/whipSuccess";

interface ApplyWhipResult {
  fellInLine: number;
  ignored: number;
}

function pickFallbackLeadershipNomination(
  npp: NPP,
  nominations: SpeakerNomination[]
): SpeakerNomination | null {
  let best: { nomination: SpeakerNomination; score: number } | null = null;

  for (const nomination of nominations) {
    let score = 0;
    if (nomination.nomineeParty && nomination.nomineeParty === npp.party) score += 100;
    if (
      nomination.nomineeCountryId &&
      npp.countryId &&
      nomination.nomineeCountryId === npp.countryId
    ) {
      score += 10;
    }
    if (nomination.nomineeState && nomination.nomineeState === npp.homeState) score += 5;

    if (!best || score > best.score) {
      best = { nomination, score };
    }
  }

  return best?.nomination ?? null;
}

function pickFallbackGovernmentVote(
  targetType: "pmAppointmentVote" | "noConfidenceVote",
  voteDoc: { nomineePartyId?: string | null; coalitionPartyIds?: string[] | null } | undefined,
  npp: NPP,
  governmentFormation: GovernmentFormation | null
): "aye" | "nay" {
  const coalitionPartyIds =
    targetType === "pmAppointmentVote"
      ? (voteDoc?.coalitionPartyIds ?? [])
      : (governmentFormation?.coalitionPartyIds ?? []);
  const governingPartyId =
    targetType === "pmAppointmentVote"
      ? (voteDoc?.nomineePartyId ?? null)
      : (governmentFormation?.governingPartyId ?? null);
  const backsGovernment =
    !!npp.party && (npp.party === governingPartyId || coalitionPartyIds.includes(npp.party));

  if (targetType === "pmAppointmentVote") {
    return backsGovernment ? "aye" : "nay";
  }
  return backsGovernment ? "nay" : "aye";
}

function pickFallbackCabinetVote(
  npp: NPP,
  nomination: CabinetNomination
): "for" | "against" | "abstain" {
  if (!npp.party) return "abstain";
  if (nomination.nomineeParty && nomination.nomineeParty === npp.party) return "for";
  if (nomination.nomineeParty) return "against";
  return "abstain";
}

/**
 * Cross-pressure inputs needed by `applyWhipVotesToBill` to resolve NPP votes
 * deterministically (Phase 4 of party-npp-rework). Callers are responsible for
 * loading these — the function does no DB lookups for the resolver inputs.
 */
export interface ApplyBillWhipResolverContext {
  /** Looked up by `bill.legislationTypeId`. May be null on legacy / non-policy bills. */
  legislationType: LegislationType | null;
  /** Map of stateId → StateDemographics, used to compute the district force per NPP. */
  stateDemographicsByState: Map<string, StateDemographics>;
  /** Current game turn for the persisted prediction snapshot. */
  currentTurn: number;
}

const LOCAL_BILL_FORCE_WEIGHTS = {
  ideology: 1,
  whip: 1,
  district: 1.35,
  donors: 0.65,
} as const;

/**
 * Cast votes for NPPs who haven't voted yet on the given bill, using the whip
 * direction the chair is currently issuing. The whip first runs a hidden
 * loyalty/stubbornness roll; on success the NPP falls in line, and on failure
 * the vote falls back to the deterministic cross-pressure verdict.
 *
 * Returns counts of NPPs whose verdict aligned with the whip (`fellInLine`) and
 * NPPs whose cross-pressure resisted it (`ignored`).
 */
export async function applyWhipVotesToBill(
  db: Db,
  bill: Bill,
  direction: "for" | "against",
  nppOfficials: ElectedOfficial[],
  nppMap: Map<string, NPP>,
  resolverCtx: ApplyBillWhipResolverContext,
  mode: NppWhipMode = "hard",
  statecraftBonus = 0
): Promise<ApplyWhipResult> {
  // Soft NPP bill whips are advisory only: they persist on the whip document
  // so autonomous turn-time cross-pressure can see them later, but they do not
  // immediately write votes when the chair clicks the button.
  if (mode === "soft") {
    return { fellInLine: 0, ignored: 0 };
  }

  const isOtherChamber = bill.status === "active_other";
  // US veto override uses dedicated vetoOverride* fields; JP Shūgiin override
  // reuses the main `votes` field but otherwise behaves like a US override
  // (abstain not allowed). Treat them separately for the vote-field choice
  // and together for the abstain-coercion rule.
  const isUsOverride = bill.status === "veto_override";
  const isJpOverride = bill.status === "override_shugiin";
  const overrideForbidsAbstain = isUsOverride || isJpOverride;

  const voteField = isOtherChamber
    ? "otherChamberVotes"
    : isUsOverride
      ? "vetoOverrideVotes"
      : "votes";

  const existingVotes =
    (isOtherChamber
      ? bill.otherChamberVotes
      : isUsOverride
        ? bill.vetoOverrideVotes
        : bill.votes) ?? {};

  /**
   * On a CONCURRENT bill these forks are per-OFFICIAL, not per-bill.
   *
   * The same shape as `applyPlayerWhipToBill` MINUS the snapshot — this function writes
   * no `whippedFromVote`. Routing an upper-chamber official through the lower branch
   * would put their vote and weight in the lower tally, letting the bill pass on the
   * other house's votes.
   */
  const isConcurrent = bill.status === "active_both";
  const lowerOfficeType = isConcurrent
    ? getOfficeTypeForChamber(
        (bill.countryId ?? "US") as CountryId,
        bill.originChamber === "joint" ? (bill.currentChamber ?? "") : bill.originChamber
      )
    : "";
  const fieldForOfficial = (officeType: string) =>
    isConcurrent
      ? resolveBillVoteField(bill, { voterOfficeType: officeType, lowerOfficeType })
      : voteField;
  const votesInField = (field: string) =>
    (field === "otherChamberVotes"
      ? bill.otherChamberVotes
      : field === "vetoOverrideVotes"
        ? bill.vetoOverrideVotes
        : bill.votes) ?? {};

  /** Net per-field deltas — one bucket for every non-concurrent status. */
  const byField = new Map<
    string,
    { updates: Record<string, "for" | "against" | "abstain">; f: number; a: number; ab: number }
  >();
  const bucket = (field: string) => {
    let b = byField.get(field);
    if (!b) {
      b = { updates: {}, f: 0, a: 0, ab: 0 };
      byField.set(field, b);
    }
    return b;
  };

  const whipDirective = { direction };
  let fellInLine = 0;
  let ignored = 0;

  // Snapshot of cross-pressure forces per NPP — persisted at the end so the
  // prediction surface reflects the post-whip state.
  const predictionOps: Array<{
    nppId: ObjectId;
    forces: { ideology: number; whip: number; district: number; donors: number };
    donorsLabel: string;
    verdict: "for" | "against" | "abstain";
    resolvedVote: "for" | "against" | "abstain";
  }> = [];

  const seenNppIds = new Set<string>();
  for (const official of nppOfficials) {
    if (!official.nppId) continue;
    if ((official.countryId ?? "US") !== (bill.countryId ?? "US")) continue;
    const nppIdStr = official.nppId.toString();
    if (seenNppIds.has(nppIdStr)) continue;
    seenNppIds.add(nppIdStr);
    const nppKey = `npp_${nppIdStr}`;
    // Read this official's OWN map: on a concurrent bill the two chambers are separate.
    const officialField = fieldForOfficial(official.officeType);
    const previousVote = votesInField(officialField)[nppKey];

    // Already voting in the whip direction — leave them alone
    if (previousVote === direction) {
      fellInLine++;
      continue;
    }

    const npp = nppMap.get(official.nppId.toString());
    if (!npp) continue;

    // Country guard: an NPP may only be whipped onto its own country's bill.
    // Defense-in-depth against the cross-country party sequentialId collision
    // (bug #0699) — callers country-scope their official query, but this keeps
    // the invariant local to the writer.
    if ((npp.countryId ?? "US") !== (bill.countryId ?? "US")) continue;

    // Re-resolve the NPP's vote with the new whip applied via cross-pressure.
    const homeStateDemographics = resolverCtx.stateDemographicsByState.get(npp.homeState) ?? null;
    const { forces, donorsLabel } = computeCrossPressureForces(npp, bill, {
      legislationType: resolverCtx.legislationType,
      homeStateDemographics,
      whips: { partyWhip: whipDirective, caucusWhip: null },
    });
    const rawVerdict = verdictFromForces(forces);
    const whipSuccess = resolveNppWhipSuccess(npp, mode, statecraftBonus);
    let vote: "for" | "against" | "abstain" = whipSuccess.success ? direction : rawVerdict;

    // Override votes don't allow abstain (US veto override or JP Shūgiin override)
    if (overrideForbidsAbstain && vote === "abstain") {
      vote = "against";
    }

    // If recalculated vote matches their existing vote, nothing to change
    if (previousVote === vote) {
      if (vote === direction) fellInLine++;
      else ignored++;
      continue;
    }

    // Track compliance
    if (vote === direction) {
      fellInLine++;
    } else {
      ignored++;
    }

    const weight = official.seatsHeld ?? 1;
    const b = bucket(officialField);
    b.updates[nppKey] = vote;

    // Subtract old vote tally if overriding a previous vote
    if (previousVote) {
      if (previousVote === "for") b.f -= weight;
      else if (previousVote === "against") b.a -= weight;
      else b.ab -= weight;
    }

    // Add new vote tally
    if (vote === "for") b.f += weight;
    else if (vote === "against") b.a += weight;
    else b.ab += weight;

    predictionOps.push({
      nppId: official.nppId,
      forces,
      donorsLabel,
      verdict: rawVerdict,
      resolvedVote: vote,
    });
  }

  if (byField.size === 0) {
    return { fellInLine, ignored };
  }

  /** Counter names per vote field. Override carries no abstain counter. */
  const TALLY: Record<string, [string, string, string | null]> = {
    votes: ["votesFor", "votesAgainst", "votesAbstain"],
    otherChamberVotes: [
      "otherChamberVotesFor",
      "otherChamberVotesAgainst",
      "otherChamberVotesAbstain",
    ],
    vetoOverrideVotes: ["vetoOverrideVotesFor", "vetoOverrideVotesAgainst", null],
  };

  // Build DB update
  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  const incFields: Record<string, number> = {};
  for (const [field, b] of byField) {
    for (const [k, v] of Object.entries(b.updates)) {
      setFields[`${field}.${k}`] = v;
    }
    const [forKey, againstKey, abstainKey] = TALLY[field]!;
    incFields[forKey] = b.f;
    incFields[againstKey] = b.a;
    if (abstainKey) incFields[abstainKey] = b.ab;
  }

  await db.collection<Bill>("bills").updateOne(
    { _id: bill._id },
    {
      $set: setFields,
      $inc: incFields,
    }
  );

  // Persist cross-pressure prediction snapshots so the prediction surface
  // reflects the post-whip state. One upsert per NPP per bill.
  if (predictionOps.length > 0) {
    const now = new Date();
    await db.collection<NPPVotePrediction>("nppVotePredictions").bulkWrite(
      predictionOps.map((op) => ({
        updateOne: {
          filter: { nppId: op.nppId, billId: bill._id },
          update: {
            $set: {
              computedAtTurn: resolverCtx.currentTurn,
              forces: op.forces,
              donorsLabel: op.donorsLabel,
              verdict: op.verdict,
              resolvedVote: op.resolvedVote,
              updatedAt: now,
            },
            $setOnInsert: {
              nppId: op.nppId,
              billId: bill._id,
              createdAt: now,
            },
          },
          upsert: true,
        },
      }))
    );
  }

  return { fellInLine, ignored };
}

/**
 * Local-bill sibling to `applyWhipVotesToBill`. Keeps state / regional hard
 * whips as immediate hidden-roll directives while soft whips remain advisory
 * pressure that the turn-time local resolver will consume later.
 */
export async function applyWhipVotesToStateBill(
  db: Db,
  bill: StateBill,
  direction: "for" | "against",
  nppOfficials: ElectedOfficial[],
  nppMap: Map<string, NPP>,
  resolverCtx: ApplyBillWhipResolverContext,
  mode: NppWhipMode = "hard",
  statecraftBonus = 0
): Promise<ApplyWhipResult> {
  if (mode === "soft") {
    return { fellInLine: 0, ignored: 0 };
  }

  const isOverride = bill.status === "veto_override";
  const existingVotes = isOverride ? (bill.overrideVotes ?? {}) : (bill.votes ?? {});

  const whipDirective = { direction, mode };
  const voteUpdates: Record<string, "for" | "against" | "abstain"> = {};
  let incFor = 0;
  let incAgainst = 0;
  let incAbstain = 0;
  let fellInLine = 0;
  let ignored = 0;
  let decFor = 0;
  let decAgainst = 0;
  let decAbstain = 0;
  const predictionOps: Array<{
    nppId: ObjectId;
    forces: { ideology: number; whip: number; district: number; donors: number };
    donorsLabel: string;
    verdict: "for" | "against" | "abstain";
    resolvedVote: "for" | "against" | "abstain";
  }> = [];

  const seenNppIds = new Set<string>();
  for (const official of nppOfficials) {
    if (!official.nppId) continue;
    const nppIdStr = official.nppId.toString();
    if (seenNppIds.has(nppIdStr)) continue;
    seenNppIds.add(nppIdStr);
    const nppKey = `npp_${nppIdStr}`;
    const previousVote = existingVotes[nppKey];

    if (previousVote === direction) {
      fellInLine++;
      continue;
    }

    const npp = nppMap.get(official.nppId.toString());
    if (!npp) continue;

    const homeStateDemographics = resolverCtx.stateDemographicsByState.get(npp.homeState) ?? null;
    const { forces, donorsLabel } = computeCrossPressureForces(npp, bill, {
      legislationType: resolverCtx.legislationType,
      homeStateDemographics,
      whips: { partyWhip: whipDirective, caucusWhip: null },
      weights: LOCAL_BILL_FORCE_WEIGHTS,
    });
    const rawVerdict = verdictFromForces(forces);
    const whipSuccess = resolveNppWhipSuccess(npp, mode, statecraftBonus);
    let vote: "for" | "against" | "abstain" = whipSuccess.success ? direction : rawVerdict;
    if (isOverride && vote === "abstain") {
      vote = "against";
    }

    if (previousVote === vote) {
      if (vote === direction) fellInLine++;
      else ignored++;
      continue;
    }

    if (vote === direction) fellInLine++;
    else ignored++;

    const weight = official.seatsHeld ?? 1;
    voteUpdates[nppKey] = vote;
    if (previousVote) {
      if (previousVote === "for") decFor += weight;
      else if (previousVote === "against") decAgainst += weight;
      else decAbstain += weight;
    }
    if (vote === "for") incFor += weight;
    else if (vote === "against") incAgainst += weight;
    else incAbstain += weight;

    predictionOps.push({
      nppId: official.nppId,
      forces,
      donorsLabel,
      verdict: rawVerdict,
      resolvedVote: vote,
    });
  }

  if (Object.keys(voteUpdates).length === 0) {
    return { fellInLine, ignored };
  }

  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(voteUpdates)) {
    const voteField = isOverride ? "overrideVotes" : "votes";
    setFields[`${voteField}.${key}`] = value;
  }

  const incFields: Record<string, number> = {};
  if (isOverride) {
    incFields.overrideVotesFor = incFor - decFor;
    incFields.overrideVotesAgainst = incAgainst - decAgainst;
  } else {
    incFields.votesFor = incFor - decFor;
    incFields.votesAgainst = incAgainst - decAgainst;
    incFields.votesAbstain = incAbstain - decAbstain;
  }

  await db
    .collection<StateBill>("stateBills")
    .updateOne({ _id: bill._id }, { $set: setFields, $inc: incFields });

  if (predictionOps.length > 0) {
    const now = new Date();
    await db.collection<NPPVotePrediction>("nppVotePredictions").bulkWrite(
      predictionOps.map((op) => ({
        updateOne: {
          filter: { nppId: op.nppId, stateBillId: bill._id },
          update: {
            $set: {
              computedAtTurn: resolverCtx.currentTurn,
              forces: op.forces,
              donorsLabel: op.donorsLabel,
              verdict: op.verdict,
              resolvedVote: op.resolvedVote,
              updatedAt: now,
            },
            $setOnInsert: {
              nppId: op.nppId,
              stateBillId: bill._id,
              createdAt: now,
            },
          },
          upsert: true,
        },
      }))
    );
  }

  return { fellInLine, ignored };
}

/**
 * Cast votes for NPPs who haven't voted yet on a leadership nomination
 * (speaker, house leadership, or senate leadership).
 *
 * Leadership whips use the same hidden loyalty/stubbornness roll as bill
 * whips. On failure, the NPP defaults to their best same-party / same-state
 * leadership fit rather than being left unvoted.
 * Leadership elections increment votesFor by each official's seatsHeld.
 * Vote key format: `npp_${nppId}`. The whip's candidacyId determines
 * which nomination to vote for.
 */
export async function applyWhipVotesToLeadership(
  db: Db,
  candidacyId: ObjectId,
  nominationCollection: string,
  nppOfficials: ElectedOfficial[],
  nppMap: Map<string, NPP>,
  mode: NppWhipMode = "hard",
  statecraftBonus = 0
): Promise<ApplyWhipResult> {
  // Fetch active nominations for re-vote handling. House/Senate leadership
  // nominations share one collection across roles — scope to the target's role
  // so whipping Majority Whip cannot steal Pro Tempore / Majority Leader votes
  // (ticket #1046). Speaker nominations have no role and stay election-wide.
  const openNominations = await db
    .collection<SpeakerNomination>(nominationCollection)
    .find({ status: { $in: ["open", "voting"] } })
    .toArray();

  const targetNomination = openNominations.find((n) => n._id.equals(candidacyId));
  if (!targetNomination) return { fellInLine: 0, ignored: 0 };

  const targetRole = (targetNomination as SpeakerNomination & { role?: string }).role;
  const raceNominations =
    typeof targetRole === "string"
      ? openNominations.filter(
          (n) => (n as SpeakerNomination & { role?: string }).role === targetRole
        )
      : openNominations;

  let fellInLine = 0;
  let ignored = 0;
  const now = new Date();

  for (const official of nppOfficials) {
    if (!official.nppId) continue;

    const nppKey = `npp_${official.nppId.toString()}`;

    // Already voted for this candidate — skip
    if (targetNomination.votes?.[nppKey]) {
      fellInLine++;
      continue;
    }

    // Leadership votes (speaker / party leadership elections) are binding under
    // a hard whip: NPPs always follow the leadership directive and cannot defy
    // it. Only bill whips allow defiance. Soft leadership whips remain advisory
    // and keep the probabilistic compliance gate (Phase 9 / §11.1): NPPs at or
    // above the threshold "fall in line"; below it they fall back to their best
    // same-party / same-state fit.
    const npp = nppMap.get(official.nppId.toString());
    if (!npp) continue;
    const obeysWhip = mode === "hard" || resolveNppWhipSuccess(npp, mode, statecraftBonus).success;
    if (!obeysWhip) {
      const fallbackNomination = pickFallbackLeadershipNomination(npp, raceNominations);
      if (!fallbackNomination) {
        ignored++;
        continue;
      }

      await castLeadershipVote(
        db,
        nominationCollection,
        raceNominations,
        nppKey,
        fallbackNomination._id,
        now,
        official.seatsHeld ?? 1
      );

      ignored++;
      continue;
    }

    await castLeadershipVote(
      db,
      nominationCollection,
      raceNominations,
      nppKey,
      candidacyId,
      now,
      official.seatsHeld ?? 1
    );

    fellInLine++;
  }

  return { fellInLine, ignored };
}

/**
 * Cast votes for NPPs who haven't voted yet on a PM appointment vote or
 * no-confidence motion. These use the new pmAppointmentVotes /
 * noConfidenceVotes collections with `votes` field and "aye"/"nay" values.
 *
 * Whip direction "for" → "aye", "against" → "nay".
 * NPPs get a hidden loyalty/stubbornness whip roll first; if they resist,
 * they fall back to their normal government-position heuristic.
 */
export async function applyWhipVotesToGovernmentVote(
  db: Db,
  voteId: ObjectId,
  targetType: "pmAppointmentVote" | "noConfidenceVote",
  direction: "for" | "against",
  nppOfficials: ElectedOfficial[],
  nppMap: Map<string, NPP>,
  mode: NppWhipMode = "hard",
  statecraftBonus = 0
): Promise<ApplyWhipResult> {
  // Load the vote document from the correct collection — kept separate for TypeScript to narrow types
  const voteDoc =
    targetType === "pmAppointmentVote"
      ? await getPMAppointmentVotesCollection(db).findOne({ _id: voteId })
      : await getNoConfidenceVotesCollection(db).findOne({ _id: voteId });

  if (!voteDoc || voteDoc.status !== "active") return { fellInLine: 0, ignored: 0 };

  const governmentFormation =
    targetType === "noConfidenceVote"
      ? await getGovernmentFormationsCollection(db).findOne({ _id: voteDoc.countryId })
      : null;

  const voteChoice: "aye" | "nay" = direction === "for" ? "aye" : "nay";
  const votes = voteDoc.votes ?? {};

  let fellInLine = 0;
  let ignored = 0;
  let incFor = 0;
  let incAgainst = 0;
  let decFor = 0;
  let decAgainst = 0;
  const setFields: Record<string, unknown> = { updatedAt: new Date() };

  const seenNppIds = new Set<string>();
  for (const official of nppOfficials) {
    if (!official.nppId) continue;
    const nppIdStr = official.nppId.toString();
    if (seenNppIds.has(nppIdStr)) continue;
    seenNppIds.add(nppIdStr);

    const nppKey = `npp_${nppIdStr}`;
    const previousVote = votes[nppKey] as "aye" | "nay" | undefined;

    // Already voting in the whip direction
    if (previousVote === voteChoice) {
      fellInLine++;
      continue;
    }

    // Government votes (PM appointment / no-confidence) are binding under a hard
    // whip: NPPs always follow the leadership directive — no defiance. Only bill
    // whips allow defiance. Soft government whips remain advisory and keep the
    // probabilistic compliance gate (Phase 9 / §11.1): below-threshold NPPs
    // ignore the directive and fall back to their government-position heuristic.
    const npp = nppMap.get(official.nppId.toString());
    let pmFallbackContext:
      { nomineePartyId?: string | null; coalitionPartyIds?: string[] | null } | undefined;
    if (targetType === "pmAppointmentVote") {
      const pmVoteDoc = voteDoc as {
        nomineePartyId?: string | null;
        coalitionPartyIds?: string[] | null;
      };
      pmFallbackContext = {
        nomineePartyId: pmVoteDoc.nomineePartyId,
        coalitionPartyIds: pmVoteDoc.coalitionPartyIds,
      };
    }
    const resolvedVote =
      mode !== "hard" && npp && !resolveNppWhipSuccess(npp, mode, statecraftBonus).success
        ? pickFallbackGovernmentVote(targetType, pmFallbackContext, npp, governmentFormation)
        : voteChoice;

    if (previousVote === resolvedVote) {
      if (resolvedVote === voteChoice) fellInLine++;
      else ignored++;
      continue;
    }

    const weight = official.seatsHeld ?? 1;
    setFields[`votes.${nppKey}`] = resolvedVote;

    // Subtract old vote tally if overriding
    if (previousVote) {
      if (previousVote === "aye") decFor += weight;
      else decAgainst += weight;
    }

    if (resolvedVote === "aye") incFor += weight;
    else incAgainst += weight;

    if (resolvedVote === voteChoice) fellInLine++;
    else ignored++;
  }

  const changed = Object.keys(setFields).length > 1; // more than just updatedAt
  if (changed) {
    const incFields: Record<string, number> = {};
    const netFor = incFor - decFor;
    const netAgainst = incAgainst - decAgainst;
    if (netFor !== 0) incFields.votesFor = netFor;
    if (netAgainst !== 0) incFields.votesAgainst = netAgainst;

    const updateOp = {
      $set: setFields,
      ...(Object.keys(incFields).length > 0 ? { $inc: incFields } : {}),
    };
    // Update the correct collection — kept separate for TypeScript to narrow types
    if (targetType === "pmAppointmentVote") {
      await getPMAppointmentVotesCollection(db).updateOne({ _id: voteId }, updateOp);
    } else {
      await getNoConfidenceVotesCollection(db).updateOne({ _id: voteId }, updateOp);
    }
  }

  return { fellInLine, ignored };
}

/**
 * Cast votes for NPPs on an open motion to vacate the Speaker's chair.
 *
 * Whip direction "for" means vacate, "against" means keep the Speaker, which
 * matches the ballot values stored on the motion, so no translation is needed.
 *
 * Unlike leadership elections this OVERWRITES an NPP's existing ballot: the
 * motion may already carry auto-cast votes from a closing window, and a whip
 * issued afterwards must be able to move them. The motion caches no tally
 * fields (`computeCongressLeadershipTally` derives them from `votes` on read),
 * so there is no counter bookkeeping to keep in step.
 *
 * Hard whips are binding, matching the other leadership-style targets. Soft
 * whips keep the probabilistic compliance gate and fall back to the bloc's own
 * vacate heuristic when an NPP resists.
 */
export async function applyWhipVotesToVacateMotion(
  db: Db,
  direction: "for" | "against",
  nppOfficials: ElectedOfficial[],
  nppMap: Map<string, NPP>,
  mode: NppWhipMode = "hard",
  statecraftBonus = 0
): Promise<ApplyWhipResult> {
  const motions = db.collection<SpeakerVacateMotion>("speakerVacateMotions");
  const motion = await motions.findOne({ _id: "current" });
  if (!motion || motion.status !== "voting") return { fellInLine: 0, ignored: 0 };

  const votes = motion.votes ?? {};
  // Only a soft whip can fall back to the bloc's own heuristic, and only the
  // heuristic needs the Speaker's party/stance, so a hard whip skips the three
  // reads entirely.
  const speakerContext = mode === "hard" ? null : await loadVacateSpeakerContext(db, motion);

  let fellInLine = 0;
  let ignored = 0;
  const setFields: Record<string, unknown> = { updatedAt: new Date() };

  const seenNppIds = new Set<string>();
  for (const official of nppOfficials) {
    if (!official.nppId) continue;
    const nppIdStr = official.nppId.toString();
    if (seenNppIds.has(nppIdStr)) continue;
    seenNppIds.add(nppIdStr);

    const nppKey = `npp_${nppIdStr}`;
    const previousVote = votes[nppKey];
    const npp = nppMap.get(nppIdStr);

    const resolvedVote =
      speakerContext && npp && !resolveNppWhipSuccess(npp, mode, statecraftBonus).success
        ? nppVacateMotionVote({
            nppParty: npp.party,
            nppStance: nppStance(npp),
            speakerParty: speakerContext.speakerParty,
            speakerStance: speakerContext.speakerStance,
            majorPartyIds: speakerContext.majorPartyIds,
            rng: Math.random,
          })
        : direction;

    if (previousVote === resolvedVote) {
      if (resolvedVote === direction) fellInLine++;
      else ignored++;
      continue;
    }

    setFields[`votes.${nppKey}`] = resolvedVote;
    if (resolvedVote === direction) fellInLine++;
    else ignored++;
  }

  if (Object.keys(setFields).length > 1) {
    await motions.updateOne({ _id: "current", status: "voting" }, { $set: setFields });
  }

  return { fellInLine, ignored };
}

/**
 * Cast votes for NPPs who haven't voted yet on a cabinet nomination.
 *
 * Cabinet whips use the same hidden loyalty/stubbornness roll as the other
 * NPP whip targets; on resistance, the NPP reverts to the normal cabinet
 * fallback heuristic instead of blindly obeying.
 * Uses seat weights. Vote key format: `npp_${nppId}`.
 */
export async function applyWhipVotesToCabinet(
  db: Db,
  nominationId: ObjectId,
  direction: "for" | "against",
  nppOfficials: ElectedOfficial[],
  nppMap: Map<string, NPP>,
  mode: NppWhipMode = "hard",
  statecraftBonus = 0
): Promise<ApplyWhipResult> {
  const nomination = await db
    .collection<CabinetNomination>("cabinetNominations")
    .findOne({ _id: nominationId });
  if (!nomination || nomination.status !== "active") return { fellInLine: 0, ignored: 0 };

  const existingVotes = nomination.votes ?? {};
  const voteValue: "for" | "against" = direction;

  let fellInLine = 0;
  let ignored = 0;
  let incFor = 0;
  let incAgainst = 0;
  let incAbstain = 0;
  let decFor = 0;
  let decAgainst = 0;
  let decAbstain = 0;
  const setFields: Record<string, unknown> = { updatedAt: new Date() };

  const seenNppIds = new Set<string>();
  for (const official of nppOfficials) {
    if (!official.nppId) continue;
    const nppIdStr = official.nppId.toString();
    if (seenNppIds.has(nppIdStr)) continue;
    seenNppIds.add(nppIdStr);

    const nppKey = `npp_${nppIdStr}`;
    const previousVote = existingVotes[nppKey] as "for" | "against" | "abstain" | undefined;

    // Already voting in the whip direction
    if (previousVote === direction) {
      fellInLine++;
      continue;
    }

    // Cabinet votes are binding under a hard whip: NPPs always follow the
    // leadership directive — no defiance. Only bill whips allow defiance. Soft
    // cabinet whips remain advisory and keep the probabilistic compliance gate
    // (Phase 9 / §11.1): below-threshold NPPs ignore the directive and fall back
    // to the normal cabinet heuristic.
    const npp = nppMap.get(official.nppId.toString());
    const resolvedVote =
      mode !== "hard" && npp && !resolveNppWhipSuccess(npp, mode, statecraftBonus).success
        ? pickFallbackCabinetVote(npp, nomination)
        : voteValue;

    if (previousVote === resolvedVote) {
      if (resolvedVote === voteValue) fellInLine++;
      else ignored++;
      continue;
    }

    const weight = official.seatsHeld ?? 1;
    setFields[`votes.${nppKey}`] = resolvedVote;

    // Subtract old vote tally if overriding
    if (previousVote) {
      if (previousVote === "for") decFor += weight;
      else if (previousVote === "against") decAgainst += weight;
      else decAbstain += weight;
    }

    if (resolvedVote === "for") incFor += weight;
    else if (resolvedVote === "against") incAgainst += weight;
    else incAbstain += weight;

    if (resolvedVote === voteValue) fellInLine++;
    else ignored++;
  }

  const changed = Object.keys(setFields).length > 1; // more than just updatedAt
  if (changed) {
    const incFields: Record<string, number> = {};
    const netFor = incFor - decFor;
    const netAgainst = incAgainst - decAgainst;
    const netAbstain = incAbstain - decAbstain;
    if (netFor !== 0) incFields.votesFor = netFor;
    if (netAgainst !== 0) incFields.votesAgainst = netAgainst;
    if (netAbstain !== 0) incFields.votesAbstain = netAbstain;

    await db
      .collection<CabinetNomination>("cabinetNominations")
      .updateOne(
        { _id: nominationId },
        { $set: setFields, ...(Object.keys(incFields).length > 0 ? { $inc: incFields } : {}) }
      );
  }

  return { fellInLine, ignored };
}
