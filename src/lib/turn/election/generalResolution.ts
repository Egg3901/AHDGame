/**
 * Ordinary completed elections assign winners and advance their next cycle.
 * resolveOneGeneralElection leaves bound Assembly ballots to cohort certification,
 * which prevents a district from replacing Congress before chamber handover.
 */
import { isHu1991AssemblyCampaign } from "@/lib/countries/hu/rules/assemblyCampaign1991";
import { isBgFoundingCampaign } from "@/lib/countries/bg/rules/foundingCampaign1990";
import { isNativeRussianAssemblyElection } from "@/lib/countries/ru/rules/assemblyElection";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectedOfficial,
  ElectionStatus,
  ElectionVoteTally,
  NPP,
  OfficeType,
  CareerEvent,
  Character,
  CountryGameState,
} from "@/lib/db/types";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { updatePoliticianPagesAfterElection } from "@/lib/wiki/updatePoliticianPageOnElection";
import {
  ELECTION_TYPE_SHORT_LABEL,
  MULTI_SEAT_TYPES,
  isCommonsGeneralElection,
  isSpecialCommonsElection,
  officeKeyForElectionType,
} from "@/lib/utils/electionLabels";
import { getOfficeLabel } from "@/lib/utils/politics";
import { triggerLeadershipElectionsAfterChamberVote } from "@/lib/congress/leadershipElections";
import { resolvePresidentElection } from "@/lib/turn/election/presidentResolution";
import { resolveNGPresidentElection } from "@/lib/turn/election/ngPresidentResolution";
import {
  COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS,
  COUNTRY_CONFIGS,
  isPresidentialGovernmentType,
  type CountryId,
} from "@/lib/constants/countries";
import { isExecutiveOffice } from "@/lib/elections/executiveOffice";
import { spawnHouseElection, spawnCommonsElection } from "@/lib/turn/election/electionSpawning";
import { countPrStv, validateRankedBallots } from "./rules/prStv";
import { allocateSeats } from "@/lib/turn/election/seatAllocation";
import { loadApportionment } from "@/lib/elections/apportionment";
import { getUkCommonsSeats } from "@/lib/constants/states";
import { blocListQuota, blocListQuotaForGovernment } from "@/lib/constants/blocList";
import { getCountryState } from "@/lib/countryState";
import { isRedistrictingEnabled } from "@/lib/redistricting/flag";
import { districtedHouseResolution } from "@/lib/redistricting/districtedHouseResolution";
import { getGameStateCollection } from "@/lib/db/collections";
import { maybeReconcileBundestag } from "@/lib/turn/election/germanyAMS";
import { updatePartyPresence } from "@/lib/turn/partyOrg";
import { notifyGovernorOfSenateVacancy } from "@/lib/governors/senateVacancy";
import { maybeApplyIndependenceDesireHook } from "@/lib/turn/election/independenceDesireHook";
import {
  buildJapanMixedRegionalList,
  countJapanMixedShugiin,
  remapJapanShugiinListVotes,
} from "@/lib/countries/jp/rules/mixedShugiinCount";
import { getExecutiveOfficeKeys } from "@/lib/elections/executiveOffice";
import { getElectionMethod } from "@/lib/elections/electionMethod";
import { bgDhondtSeats } from "@/lib/countries/bg/rules/ordinaryElection";
import { allocateHuModernPeople } from "@/lib/countries/hu/rules/modernMandates2011";
import type { ElectionNewsOutcome } from "./electionNotifications";
import { voidDebateSessionsForElection } from "@/lib/debate/debateSessionLifecycle";
import {
  buildPrimaryShareMap,
  carryForwardCommonsConstituency,
  getChamberClass,
  multiSeatOfficialFilter,
  preserveExecutiveOffice,
  resolveElectionWithNoRankedCandidates,
  resolveElectionWithNoTally,
  resolveElectionWithZeroVotes,
  sweepStaleOffice,
  type OneElectionResult,
} from "./generalResolutionHelpers";
import { logger } from "../../observability/logger";
import { finishFinalizedElectionCleanup } from "./finalizedElectionCleanup";
import { applyConversionVotePenalty, applyLegacySeatFloor } from "./conversionTerms";
import { loadSurvivingPartyResolver } from "@/lib/parties/survivingParty";
import { captureElectionWon } from "@/lib/analytics/electionAnalytics";
import { captureOfficeTransition } from "@/lib/analytics/officeTransitionAnalytics";

export type { OneElectionResult } from "./generalResolutionHelpers";

async function recordJapanShugiinRegionalCapacity(
  db: Db,
  election: Election,
  currentTurn: number,
  now: Date
): Promise<void> {
  if (
    election.countryId !== "JP" ||
    (election.electionType !== "shugiin" && election.electionType !== "snap_shugiin") ||
    !election.japanShugiinRules ||
    !election.state
  )
    return;
  try {
    const { districtSeats, listSeats, ruleVersion } = election.japanShugiinRules;
    const totalSeats = districtSeats + listSeats;
    if (
      !Number.isSafeInteger(districtSeats) ||
      !Number.isSafeInteger(listSeats) ||
      districtSeats < 0 ||
      listSeats < 0 ||
      totalSeats !== election.totalSeats
    ) {
      throw new Error(
        "Resolved Japan Shugiin capacity does not match its frozen election snapshot"
      );
    }
    const regionRuleKey = `jpShugiinResolvedRegionalRules.${election.state}`;
    await db.collection<CountryGameState>("countryGameStates").updateOne(
      {
        _id: "JP",
        $or: [
          { [`${regionRuleKey}.cycle`]: { $exists: false } },
          { [`${regionRuleKey}.cycle`]: { $lte: election.cycle } },
        ],
      },
      {
        $set: {
          [regionRuleKey]: {
            ruleVersion,
            totalSeats,
            districtSeats,
            listSeats,
            electionId: election._id.toString(),
            cycle: election.cycle,
            resolvedAtTurn: currentTurn,
          },
        },
      }
    );
  } catch (error) {
    // Empty-race helpers already mark the election resolved. Keep a failed
    // capacity write eligible for retry, including the finalized-tally path.
    await db
      .collection<Election>("elections")
      .updateOne({ _id: election._id }, { $set: { status: "completed", updatedAt: now } });
    throw error;
  }
}

/** A failed list/holder write must keep the finalized race eligible for retry. */
async function reconcileGermanElection(db: Db, election: Election, now: Date): Promise<void> {
  if (
    getElectionMethod(election.countryId, election.electionType) !== "ams" ||
    (election.electionType !== "bundestag" && election.electionType !== "snap_bundestag")
  )
    return;
  try {
    const reconciled = await maybeReconcileBundestag(db, election.cycle, now);
    if (reconciled) {
      const { triggerBundestagspraesidentElectionAfterReconcile } =
        await import("@/lib/congress/bundestagspraesident/openElection");
      await triggerBundestagspraesidentElectionAfterReconcile(db, now);
    }
  } catch (error) {
    await db
      .collection<Election>("elections")
      .updateOne({ _id: election._id }, { $set: { status: "completed", updatedAt: now } });
    throw error;
  }
}

/**
 * Resolves a single completed election — determines winners, writes elected
 * officials, sends notifications, spawns the next cycle, and finalises the
 * tally. Extracted from resolveGeneralElections for clarity.
 */
export async function resolveOneGeneralElection(
  db: Db,
  election: Election,
  tally: ElectionVoteTally | null | undefined,
  currentTurn: number,
  now: Date,
  bgEligibleParties: ReadonlySet<string> | null = null,
  huMixedCandidateSeats?: Readonly<Record<string, number>>,
  bgOrdinaryCandidateSeats?: Readonly<Record<string, number>>
): Promise<OneElectionResult> {
  if (
    isNativeRussianAssemblyElection(election) ||
    isHu1991AssemblyCampaign(election) ||
    isBgFoundingCampaign(election)
  )
    return { resolved: false, newsOutcomes: [] };
  const newsOutcomes: ElectionNewsOutcome[] = [];

  // Atomic claim: prevent concurrent resolution from corrupting office data.
  // Only the first process to flip resolving=true proceeds; others bail out.
  const claimed = await db
    .collection<Election>("elections")
    .updateOne(
      { _id: election._id, status: "completed", resolving: { $ne: true } },
      { $set: { resolving: true, updatedAt: now } }
    );
  if (claimed.modifiedCount === 0) {
    console.log(
      `[Turn] Election ${election._id} (${election.electionType}/${election.state ?? "?"}) already being resolved by another process — skipping`
    );
    return { resolved: true, newsOutcomes: [] };
  }

  try {
    if (
      tally?.countingMethod === "pr_stv" &&
      (election.countryId !== "IE" || !["dail", "localCouncil"].includes(election.electionType))
    )
      throw new Error("Ranked PR-STV is supported only for Irish Dail and local council races");
    if (election.countryId === "BR" && election.electionType === "president") {
      const { resolveBrazilPresidentialElection } =
        await import("@/lib/countries/br/resolvePresidentialElection");
      const resolved = await resolveBrazilPresidentialElection(
        db,
        election,
        tally ?? null,
        now,
        currentTurn
      );
      if (resolved) {
        await db
          .collection<Election>("elections")
          .updateOne({ _id: election._id }, { $set: { status: "resolved", updatedAt: now } });
        await voidDebateSessionsForElection(db, election._id, now);
      }
      return { resolved, newsOutcomes: [] };
    }
    if (tally?.countingMethod === "pr_stv" && election.conversionTerms)
      throw new Error(
        "Ranked PR-STV does not support conversion vote penalties or reserved seat floors"
      );
    // BG changes from the 1991 transitional assembly to modern party-list PR.
    // The base config is the 1979 single-party FPTP chamber, so read the live
    // preset before method dispatch instead of silently using that default.
    const bgPreset =
      election.countryId === "BG"
        ? (await (await getGameStateCollection(db)).findOne({ _id: "current" }))?.preset
        : undefined;
    if (election.countryId === "BG" && !bgPreset) {
      throw new Error("Bulgaria election resolution requires the active preset");
    }
    const electionMethod = getElectionMethod(election.countryId, election.electionType, bgPreset);
    if (
      election.countryId === "BG" &&
      election.electionType === "nationalAssembly" &&
      bgPreset === "2027-default" &&
      electionMethod !== "pr_hareQuota"
    ) {
      throw new Error("Bulgaria 2027 Assembly requires parliamentary proportional representation");
    }
    if (
      election.countryId === "BG" &&
      election.electionType === "nationalAssembly" &&
      election.cycle >= 1 &&
      bgPreset === "1991-default" &&
      !tally?.finalized &&
      !bgOrdinaryCandidateSeats
    ) {
      throw new Error("Bulgarian ordinary Assembly requires its frozen national allocation");
    }
    // Phase 4: Sainte-Laguë chambers (DE Landtag) use proportional allocation
    // (5% Land-level threshold) instead of FPTP. Dispatch on the configured
    // method — `pr_sainteLague` is unique to the DE Landtag — before any other
    // logic runs.
    if (electionMethod === "pr_sainteLague") {
      const { resolveDELandtagElection } = await import("./germanyLandtag");
      if (!tally?.finalized) {
        await resolveDELandtagElection(db, election, now, currentTurn);
      }
      await db
        .collection<Election>("elections")
        .updateOne({ _id: election._id }, { $set: { status: "resolved", updatedAt: now } });
      await voidDebateSessionsForElection(db, election._id, now);
      if (tally) {
        await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
          { _id: tally._id },
          {
            $set: {
              finalized: true,
              resolutionPath: "sainte_lague",
              resolvedAtTurn: currentTurn,
            },
          }
        );
      }
      return { resolved: true, newsOutcomes };
    }

    if (
      election.countryId === "RU" &&
      election.electionType === "president" &&
      election.russianPresidentialRound
    ) {
      const { resolveRussianPresidentialElection } =
        await import("@/lib/countries/ru/resolvePresidentialElection");
      await resolveRussianPresidentialElection({
        db,
        electionId: election._id,
        turn: currentTurn,
        now,
      });
      await voidDebateSessionsForElection(db, election._id, now);
      return { resolved: true, newsOutcomes: [] };
    }

    if (tally?.finalized && election.electionType !== "president") {
      await finishFinalizedElectionCleanup(db, election, tally, now);
      // Tally already finalized (officials already written) but the election
      // was never marked "resolved" (e.g. spawnCommonsElection threw a
      // duplicate-key error on a previous turn). Recover by spawning the next
      // cycle (a no-op if it already exists) and marking this election resolved.
      if (isCommonsGeneralElection(election.electionType) && election.state) {
        await spawnCommonsElection(db, election, now);
      }
      if (election.electionType === "house") {
        await spawnHouseElection(db, election, now);
      }
      await recordJapanShugiinRegionalCapacity(db, election, currentTurn, now);
      await db
        .collection<Election>("elections")
        .updateOne(
          { _id: election._id },
          { $set: { status: "resolved" satisfies ElectionStatus, updatedAt: now } }
        );
      await voidDebateSessionsForElection(db, election._id, now);
      await reconcileGermanElection(db, election, now);
      console.log(
        `[Turn] Election ${election._id} (${election.electionType}/${election.state}) recovered — tally was already finalized`
      );
      return { resolved: true, newsOutcomes: [] };
    }

    if (!tally) {
      // No votes were recorded — clear stale officials / vacate single-seat
      // incumbents and open the next race. See resolveElectionWithNoTally.
      const result = await resolveElectionWithNoTally(db, election, now, currentTurn);
      await recordJapanShugiinRegionalCapacity(db, election, currentTurn, now);
      return result;
    }

    // ── President: per-country resolution (US electoral college; NG/bespoke
    // national popular vote + spread + run-off) ─────────────────────────────
    // Kept on electionType (not electionSystems method): this routes to a
    // per-country executive resolver that internally selects EC vs bespoke, and
    // the `headOfState` method alone cannot separate an executive `president`
    // from a ceremonial `uachtaran` (both are `fptp`/direct at that position).
    if (election.electionType === "president") {
      const bespoke =
        election.countryId != null &&
        COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS.has(election.countryId);
      const presidentResolved = bespoke
        ? await resolveNGPresidentElection(db, election, tally, now, currentTurn)
        : await resolvePresidentElection(db, election, tally, now, currentTurn);
      if (presidentResolved) {
        await db
          .collection<Election>("elections")
          .updateOne(
            { _id: election._id },
            { $set: { status: "resolved" satisfies ElectionStatus, updatedAt: now } }
          );
        await voidDebateSessionsForElection(db, election._id, now);
      }
      return { resolved: presidentResolved, newsOutcomes: [] };
    }

    // Fallback: if totalVotes is empty but snapshots have data, recover from
    // the last snapshot's cumulativeVotes. This guards against any process
    // that clears totalVotes between the final accumulation and resolution.
    const isPrStv = tally.countingMethod === "pr_stv";
    const isJapanMixedShugiin =
      election.countryId === "JP" &&
      (election.electionType === "shugiin" || election.electionType === "snap_shugiin") &&
      election.japanShugiinRules?.ruleVersion === "mixed-1994-v1";
    if (isPrStv) {
      if (election.countryId !== "IE" || !["dail", "localCouncil"].includes(election.electionType))
        throw new Error("Ranked PR-STV is supported only for Irish Dail and local council races");
      validateRankedBallots(tally.rankedBallots, tally.totalVotes);
    }
    let effectiveVotes = tally.totalVotes;
    if (Object.keys(effectiveVotes).length === 0 && tally.turnSnapshots?.length > 0) {
      const lastSnapshot = tally.turnSnapshots[tally.turnSnapshots.length - 1];
      if (lastSnapshot.cumulativeVotes && Object.keys(lastSnapshot.cumulativeVotes).length > 0) {
        effectiveVotes = lastSnapshot.cumulativeVotes;
        console.warn(
          `[Turn] Election ${election._id} (${election.electionType}/${election.state}): ` +
            `totalVotes was empty — recovered ${Object.keys(effectiveVotes).length} candidates from last snapshot (turn ${lastSnapshot.turn})`
        );
      }
    }

    let totalVotesCast = Object.values(effectiveVotes).reduce((s, v) => s + v, 0);
    const japanMixedHasBallotVotes =
      isJapanMixedShugiin &&
      (Object.values(tally.japanShugiinConstituencyVotes ?? {}).some((votesByCandidate) =>
        Object.values(votesByCandidate).some((votes) => votes > 0)
      ) ||
        Object.values(tally.japanShugiinListVotes ?? {}).some((votes) => votes > 0));

    if (totalVotesCast === 0 && !japanMixedHasBallotVotes) {
      if (isPrStv) throw new Error("PR-STV cannot resolve without cast ranked ballots");
      // Tally exists but zero votes were cast — finalize, withdraw candidates,
      // vacate stale seats and respawn. See resolveElectionWithZeroVotes.
      const result = await resolveElectionWithZeroVotes(db, election, now, currentTurn);
      await recordJapanShugiinRegionalCapacity(db, election, currentTurn, now);
      return result;
    }

    // Closed lists can seat a registered replacement with zero personal votes.
    // Preserve that nominee in the candidate load and saved result, rather than
    // discarding their national mandate because they had no tally key.
    if (bgOrdinaryCandidateSeats)
      effectiveVotes = {
        ...Object.fromEntries(Object.keys(bgOrdinaryCandidateSeats).map((id) => [id, 0])),
        ...effectiveVotes,
      };
    const candidateIdsBeforeLoad = [
      ...new Set([
        ...Object.keys(effectiveVotes),
        ...(isJapanMixedShugiin
          ? Object.values(tally.japanShugiinConstituencyVotes ?? {}).flatMap((votesByCandidate) =>
              Object.keys(votesByCandidate)
            )
          : []),
      ]),
    ];
    const candidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({
        ...(isJapanMixedShugiin
          ? {
              electionId: election._id,
              status: "active",
              $or: [
                { _id: { $in: candidateIdsBeforeLoad.map((id) => new ObjectId(id)) } },
                { isNPP: true },
                { japanShugiinListOrder: { $exists: true } },
              ],
            }
          : {
              _id: { $in: candidateIdsBeforeLoad.map((id) => new ObjectId(id)) },
              status: "active",
            }),
      })
      .toArray();
    if (isJapanMixedShugiin) {
      for (const candidate of candidates) {
        if (candidate.isNPP || candidate.japanShugiinListOrder != null) {
          effectiveVotes[candidate._id.toString()] ??= 0;
        }
      }
    }
    const candidateIds = Object.keys(effectiveVotes);

    // A candidacy filed under a party that has since merged away counts for,
    // and seats into, the party that absorbed it (ticket 1376).
    const survivingParty = await loadSurvivingPartyResolver(db, election.countryId ?? "US");
    for (const c of candidates) c.party = survivingParty(c.party) ?? c.party;

    const candidateMap = new Map(candidates.map((c) => [c._id.toString(), c]));

    // Mortality withdraws a deceased NPP's candidacies before ordinary
    // resolution. Keep the resolver safe if it runs against a stale row or a
    // concurrent process that retired the NPP after the candidate query.
    const candidateNppIds = candidates
      .filter((c): c is typeof c & { nppId: ObjectId } => !!c.isNPP && !!c.nppId)
      .map((c) => c.nppId);
    const liveCandidateNpps =
      candidateNppIds.length > 0
        ? await db
            .collection<NPP>("npps")
            .find({ _id: { $in: candidateNppIds }, retiredAt: null }, { projection: { _id: 1 } })
            .toArray()
        : [];
    const liveCandidateNppIds = new Set(liveCandidateNpps.map((npp) => npp._id.toString()));
    const retiredNppCandidateIds = new Set(
      candidates
        .filter((c) => !!c.isNPP && !!c.nppId && !liveCandidateNppIds.has(c.nppId.toString()))
        .map((c) => c._id.toString())
    );
    // A sitting national executive in a presidential system cannot take a
    // legislative (or any non-executive) seat (#2038). The resolver usually
    // seats the executive after the legislature, but a delayed executive
    // seating retry or a filing after the seating can produce the reverse
    // order. Exclude such winners before allocation so the seat falls to the
    // next eligible candidate (or the vacancy path when none remains).
    // Parliamentary heads of government legitimately sit in the legislature,
    // so this applies only where the country config is presidential.
    const executiveIneligibleCandidateIds = new Set<string>();
    if (
      election.electionType !== "president" &&
      isPresidentialGovernmentType(
        COUNTRY_CONFIGS[(election.countryId ?? "US") as CountryId]?.governmentType
      )
    ) {
      const holderCharIds = candidates
        .filter((c): c is typeof c & { characterId: ObjectId } => !c.isNPP && !!c.characterId)
        .map((c) => c.characterId);
      const holderNppIds = candidates
        .filter((c): c is typeof c & { nppId: ObjectId } => !!c.isNPP && !!c.nppId)
        .map((c) => c.nppId);
      const [holderChars, holderMpps] = await Promise.all([
        holderCharIds.length > 0
          ? db
              .collection<Character>("characters")
              .find({ _id: { $in: holderCharIds } }, { projection: { currentOffice: 1 } })
              .toArray()
          : Promise.resolve([]),
        holderNppIds.length > 0
          ? db
              .collection<NPP>("npps")
              // Seat resolution reads the office, never the 30KB stance map.
              .find({ _id: { $in: holderNppIds } }, { projection: { currentOffice: 1 } })
              .toArray()
          : Promise.resolve([]),
      ]);
      const holderOfficeById = new Map<string, Character["currentOffice"] | NPP["currentOffice"]>();
      for (const h of holderChars) holderOfficeById.set(h._id.toString(), h.currentOffice);
      for (const h of holderMpps) holderOfficeById.set(h._id.toString(), h.currentOffice);
      for (const c of candidates) {
        const holderId = c.isNPP ? c.nppId?.toString() : c.characterId?.toString();
        if (holderId && isExecutiveOffice(holderOfficeById.get(holderId) ?? null)) {
          executiveIneligibleCandidateIds.add(c._id.toString());
        }
      }
      if (executiveIneligibleCandidateIds.size > 0) {
        console.warn(
          `[Turn] Election ${election._id} (${election.electionType}/${election.state}): ` +
            `excluding ${executiveIneligibleCandidateIds.size} sitting-executive candidate(s) ineligible for a non-executive seat`
        );
      }
    }
    const droppedCandidateIds = new Set([
      ...retiredNppCandidateIds,
      ...executiveIneligibleCandidateIds,
    ]);
    if (droppedCandidateIds.size > 0) {
      if (retiredNppCandidateIds.size > 0) {
        console.warn(
          `[Turn] Election ${election._id} (${election.electionType}/${election.state}): ` +
            `excluding ${retiredNppCandidateIds.size} retired or missing NPP candidate(s)`
        );
      }
      effectiveVotes = Object.fromEntries(
        Object.entries(effectiveVotes).filter(([id]) => !droppedCandidateIds.has(id))
      );
      totalVotesCast = Object.values(effectiveVotes).reduce((sum, votes) => sum + votes, 0);
    }

    // Warn if any candidate IDs in the tally have no matching document — votes would be lost.
    const missingIds = candidateIds.filter((id) => !candidateMap.has(id));
    if (missingIds.length > 0) {
      console.warn(
        `[Turn] Election ${election._id} (${election.electionType}/${election.state}): ` +
          `${missingIds.length} candidate ID(s) in tally not found in electionCandidates — ` +
          `${isPrStv ? "preferences transfer past unavailable candidates" : "votes discarded"}: ${missingIds.join(", ")}`
      );
    }

    // Phase 5 soft electoral hook: UK SCO/WAL/NIR commons/regionalCouncil/governor
    // elections get a small ±5pp vote-share nudge driven by independenceDesire.
    // Applies to votes BEFORE ranking so the resolver picks winners from the
    // adjusted tally. No-op for any other (countryId, electionType, state) combo.
    const hookResult = await maybeApplyIndependenceDesireHook(db, {
      countryId: election.countryId ?? "",
      electionType: election.electionType,
      state: election.state ?? undefined,
      effectiveVotes,
      candidates: candidates
        .filter((c) => !retiredNppCandidateIds.has(c._id.toString()))
        .map((c) => ({ _id: c._id, party: c.party })),
      totalVotes: totalVotesCast,
    });
    if (hookResult.nudgeApplied !== 0 || hookResult.proIndyBonusApplied !== 0) {
      effectiveVotes = hookResult.adjustedVotes;
      // The transfer nudge preserves the grand total, but the multiplicative
      // pro-indy bonus inflates it. Refresh totalVotesCast so the downstream
      // share-eligibility check in allocateSeats (votes / totalVotesCast) uses
      // the new denominator instead of the stale pre-hook total.
      if (hookResult.proIndyBonusApplied !== 0) {
        totalVotesCast = Object.values(effectiveVotes).reduce((s, v) => s + v, 0);
      }
      console.log(
        `[Turn] Election ${election._id} (${election.electionType}/${election.state}): ` +
          `Devolution hook applied nudge=${hookResult.nudgeApplied.toFixed(3)}, ` +
          `proIndyBonus=${hookResult.proIndyBonusApplied.toFixed(3)}`
      );
    }

    // First election after a forced one-party-state conversion: the former
    // ruling party's votes take the conversion's penalty before ranking.
    const penalizedVotes = applyConversionVotePenalty(
      effectiveVotes,
      (id) => candidateMap.get(id)?.party,
      election.conversionTerms
    );
    if (penalizedVotes) {
      effectiveVotes = penalizedVotes;
      totalVotesCast = Object.values(effectiveVotes).reduce((s, v) => s + v, 0);
    }

    // ── Defense-in-depth: never seat a hard-deleted character ────────────────
    // Account deletion (and admin force-delete) hard-removes the character doc
    // but can leave a dangling active candidacy behind. If such a candidacy
    // out-polls the field it would otherwise be seated as a phantom official
    // referencing a character that no longer exists. Drop deleted-character
    // candidates before allocation so the seat falls to the next eligible
    // candidate (or stays vacant if none remain). NPP "candidates" have no
    // character document and are unaffected.
    const candidateCharIds = candidates
      .filter((c): c is typeof c & { characterId: ObjectId } => !c.isNPP && !!c.characterId)
      .map((c) => c.characterId);
    const deletedCandidateIds = new Set<string>();
    if (candidateCharIds.length > 0) {
      const existingChars = await db
        .collection<Character>("characters")
        .find(
          {
            _id: { $in: candidateCharIds },
            ...(bgOrdinaryCandidateSeats
              ? {
                  countryId: "BG",
                  federationPendingResidenceId: { $exists: false },
                }
              : {}),
          },
          { projection: { _id: 1 } }
        )
        .toArray();
      const existingCharIds = new Set(existingChars.map((c) => c._id.toString()));
      for (const c of candidates) {
        if (!c.isNPP && c.characterId && !existingCharIds.has(c.characterId.toString())) {
          deletedCandidateIds.add(c._id.toString());
        }
      }
      if (deletedCandidateIds.size > 0) {
        console.warn(
          `[Turn] Election ${election._id} (${election.electionType}/${election.state}): ` +
            `excluding ${deletedCandidateIds.size} winning-eligible candidate(s) whose character no longer exists`
        );
      }
    }

    const ineligibleCandidateIds = new Set([
      ...deletedCandidateIds,
      ...retiredNppCandidateIds,
      ...executiveIneligibleCandidateIds,
    ]);
    const ranked = candidateIds
      // `party` lets allocateSeats compute its minimum-share eligibility on the
      // PARTY aggregate share (same-party candidates pooled) instead of the
      // per-candidate share — see RankedCandidate.party.
      .map((id) => ({
        id,
        votes: effectiveVotes[id] ?? 0,
        party: candidateMap.get(id)?.party,
        isNPP: candidateMap.get(id)?.isNPP,
      }))
      .filter(({ id }) => candidateMap.has(id) && !ineligibleCandidateIds.has(id))
      .sort((a, b) => b.votes - a.votes);

    // Dropped candidates must not inflate the share-eligibility denominator or
    // reach the district allocator used by multi-seat elections.
    if (ineligibleCandidateIds.size > 0) {
      effectiveVotes = Object.fromEntries(
        Object.entries(effectiveVotes).filter(([id]) => !ineligibleCandidateIds.has(id))
      );
      totalVotesCast = ranked.reduce((sum, { votes }) => sum + votes, 0);
    }

    if (ranked.length === 0) {
      if (isPrStv) throw new Error("PR-STV cannot resolve without eligible candidates");
      // Every ranked candidate was dropped (missing docs / deleted characters)
      // — same cleanup as zero votes. See resolveElectionWithNoRankedCandidates.
      const result = await resolveElectionWithNoRankedCandidates(db, election, now, currentTurn);
      await recordJapanShugiinRegionalCapacity(db, election, currentTurn, now);
      return result;
    }

    const totalSeats = election.totalSeats ?? 1;
    // House seat counts are preset-dependent (1990 vs 2020 census). Fetch the
    // active preset only for House races; other multi-seat types ignore the
    // `houseSeats` arg, so `undefined` correctly falls through to the default.
    // Commons likewise needs the era map (625 in 1953 vs modern 650) — without
    // it allocateSeats always used the modern UK_COMMONS_SEATS (ticket #1058).
    let houseSeats: Record<string, number> | undefined;
    let commonsSeats: Record<string, number> | undefined;
    let allocationMethod = election.allocationMethod;
    let gsForHouse: {
      preset?: string;
      redistrictingEnabled?: boolean;
      currentYear?: number;
    } | null = null;
    if (election.electionType === "house") {
      gsForHouse = await (await getGameStateCollection(db)).findOne({ _id: "current" });
      // Live (census-updated) House apportionment; equals the preset seed until a
      // decennial census reapportions (P1d-2). `currentYear` keeps a state
      // admitted mid-game in the map — without it the admitted set is built as of
      // the preset year, so `authoritativeSeats` silently fell back to the
      // election's own `totalSeats` for Alaska and Hawaii (#1190).
      houseSeats = (await loadApportionment(db, gsForHouse?.preset, gsForHouse?.currentYear))
        .houseSeats;
    }

    // Older Japan races predate the per-race snapshot. Resolve them against
    // their world's era rules; newly spawned races keep their frozen method.
    if (
      !allocationMethod &&
      election.countryId === "JP" &&
      election.japanShugiinRules?.ruleVersion !== "mixed-1994-v1" &&
      (election.electionType === "shugiin" || election.electionType === "snap_shugiin")
    ) {
      const gameState = await (await getGameStateCollection(db)).findOne({ _id: "current" });
      allocationMethod = getElectionMethod("JP", election.electionType, gameState?.preset);
    }

    if (
      election.electionType === "commons" ||
      election.electionType === "snap_commons" ||
      isSpecialCommonsElection(election.electionType)
    ) {
      const gsForCommons = await (await getGameStateCollection(db)).findOne({ _id: "current" });
      commonsSeats = getUkCommonsSeats(gsForCommons?.preset);
    }

    // Districted per-district resolution (US House, flag on). Returns null when the
    // state has no congressionalDistricts docs → fall back to legacy allocateSeats.
    let districted: Awaited<ReturnType<typeof districtedHouseResolution>> = null;
    if (
      election.electionType === "house" &&
      (election.countryId ?? "US") === "US" &&
      isRedistrictingEnabled(gsForHouse)
    ) {
      const candidateParty: Record<string, string> = {};
      const candidateCharacterId: Record<string, string | null> = {};
      const candidateNppId: Record<string, string | null> = {};
      for (const id of Object.keys(effectiveVotes)) {
        const c = candidateMap.get(id);
        candidateParty[id] = c?.party ?? tally?.candidateParties?.[id] ?? "";
        // NPP candidates carry characterId === nppId, but that id lives in the
        // `npps` collection. Route them to the NPP holder field so seat holders
        // resolve correctly (else the seat renders as unheld).
        if (c?.isNPP && c?.nppId) {
          candidateNppId[id] = c.nppId.toString();
          candidateCharacterId[id] = null;
        } else {
          candidateCharacterId[id] = c?.characterId ? c.characterId.toString() : null;
          candidateNppId[id] = null;
        }
      }
      const primaryShares = buildPrimaryShareMap(tally?.primaryResults ?? null);
      districted = await districtedHouseResolution(db, {
        countryId: "US",
        stateId: election.state as string,
        candidateVotes: effectiveVotes,
        candidateParty,
        candidateCharacterId,
        candidateNppId,
        primaryShares,
        districtBoosts: (
          election as {
            districtCampaignBoosts?: Record<string, Record<string, number>>;
          }
        ).districtCampaignBoosts,
        now,
        // The one caller that may write holders: this is the real result.
        persist: true,
      });
    }

    const configuredBlocQuota = blocListQuota(election.countryId);
    const runtimeBlocQuota = configuredBlocQuota
      ? blocListQuotaForGovernment(
          election.countryId,
          (await getCountryState(db, election.countryId)).governmentType
        )
      : null;
    const prStvResult = isPrStv
      ? countPrStv(
          ranked.map((c) => c.id),
          totalSeats,
          tally.rankedBallots!
        )
      : undefined;
    if (prStvResult) {
      const holders = ranked.map(({ id }) => {
        const c = candidateMap.get(id)!;
        return `${c.isNPP ? "npp" : "player"}:${c.isNPP ? c.nppId : c.characterId}`;
      });
      if (new Set(holders).size !== holders.length)
        throw new Error("PR-STV requires distinct candidate holder identities");
    }
    const bgOrdinaryAllocation = bgOrdinaryCandidateSeats
      ? (() => {
          const seatsEstimate: Record<string, number> = { ...bgOrdinaryCandidateSeats };
          const eligibleIds = new Set(ranked.map((row) => row.id));
          for (const [id, seats] of Object.entries(seatsEstimate)) {
            const candidate = candidateMap.get(id);
            if (
              !Number.isSafeInteger(seats) ||
              seats < 0 ||
              (seats > 0 && (!eligibleIds.has(id) || !candidate || (!candidate.isNPP && seats > 1)))
            )
              throw new Error("Bulgarian frozen allocation has an unavailable or invalid holder");
          }
          if (Object.values(seatsEstimate).reduce((sum, seats) => sum + seats, 0) !== totalSeats)
            throw new Error("Bulgarian frozen allocation does not fill the regional capacity");
          return {
            isMultiSeat: true,
            authoritativeSeats: totalSeats,
            seatsEstimate,
            winners: Object.entries(seatsEstimate).filter(([, seats]) => seats > 0) as [
              string,
              number,
            ][],
            losers: Object.entries(seatsEstimate)
              .filter(([, seats]) => seats === 0)
              .map(([id]) => id),
          };
        })()
      : null;
    const bgAllocation =
      bgEligibleParties &&
      election.countryId === "BG" &&
      election.electionType === "nationalAssembly" &&
      election.cycle === 1
        ? (() => {
            const seatsEstimate = bgDhondtSeats(
              ranked.map((candidate) => {
                const row = candidateMap.get(candidate.id);
                if (!row?.party) throw new Error("Bulgaria list candidate has no party");
                return {
                  id: candidate.id,
                  party: row.party,
                  votes: candidate.votes,
                  listOrder: row.enteredAt?.getTime() ?? 0,
                };
              }),
              totalSeats,
              bgEligibleParties
            );
            return {
              isMultiSeat: true,
              authoritativeSeats: totalSeats,
              seatsEstimate,
              winners: Object.entries(seatsEstimate).filter(([, seats]) => seats > 0) as [
                string,
                number,
              ][],
              losers: Object.entries(seatsEstimate)
                .filter(([, seats]) => seats === 0)
                .map(([id]) => id),
            };
          })()
        : null;
    const huAllocation = huMixedCandidateSeats
      ? (() => {
          const seatsEstimate: Record<string, number> = Object.fromEntries(
            ranked.map((candidate) => [candidate.id, 0])
          );
          const wantedByParty: Record<string, number> = {};
          for (const [candidateId, seats] of Object.entries(huMixedCandidateSeats)) {
            const rawParty =
              candidateMap.get(candidateId)?.party ?? tally.candidateParties[candidateId];
            if (!rawParty) throw new Error("Hungary mixed mandate has no party");
            const party = rawParty === "independent" ? `independent@${candidateId}` : rawParty;
            wantedByParty[party] = (wantedByParty[party] ?? 0) + seats;
          }
          const assigned = allocateHuModernPeople({
            quotas: wantedByParty,
            people: ranked.map((candidate) => ({
              id: candidate.id,
              partyId:
                candidate.party === "independent"
                  ? `independent@${candidate.id}`
                  : (candidate.party ?? ""),
              votes: candidate.votes,
              isNpc: candidateMap.get(candidate.id)?.isNPP === true,
            })),
          });
          if (!assigned) throw new Error("Hungary modern mandate has insufficient viable people");
          Object.assign(seatsEstimate, assigned);
          return {
            isMultiSeat: true,
            authoritativeSeats: totalSeats,
            seatsEstimate,
            winners: Object.entries(seatsEstimate).filter(([, seats]) => seats > 0) as [
              string,
              number,
            ][],
            losers: Object.entries(seatsEstimate)
              .filter(([, seats]) => seats === 0)
              .map(([id]) => id),
          };
        })()
      : null;
    const japanMixedAllocation = isJapanMixedShugiin
      ? (() => {
          const districtVotes = tally.japanShugiinConstituencyVotes;
          const listVotes = tally.japanShugiinListVotes;
          if (!districtVotes || !listVotes)
            throw new Error("Japan mixed election lacks separate district and list ballots");
          const counted = countJapanMixedShugiin(
            {
              districtVotes: Object.fromEntries(
                Object.entries(districtVotes).map(([districtId, votesByCandidate]) => [
                  districtId,
                  Object.entries(votesByCandidate)
                    .filter(
                      ([candidateId]) =>
                        candidateMap.has(candidateId) && !ineligibleCandidateIds.has(candidateId)
                    )
                    .map(([candidateId, votes]) => {
                      const candidate = candidateMap.get(candidateId)!;
                      const partyId = candidate.party ?? tally.candidateParties[candidateId];
                      if (!partyId)
                        throw new Error("Japan district ballot names a candidate without a party");
                      return {
                        candidateId,
                        partyId,
                        votes,
                        isNPP: candidate.isNPP,
                      };
                    }),
                ])
              ),
              listVotesByRegion: {
                [election.state]: remapJapanShugiinListVotes(
                  listVotes,
                  (partyId) => survivingParty(partyId) ?? null
                ),
              },
              regionalLists: {
                [election.state]: buildJapanMixedRegionalList(
                  candidates.flatMap((candidate) => {
                    const candidateId = candidate._id.toString();
                    const partyId = candidate.party;
                    return partyId
                      ? [
                          {
                            candidateId,
                            partyId,
                            listOrder: candidate.japanShugiinListOrder,
                            isNPP: candidate.isNPP,
                            enteredAt: candidate.enteredAt?.getTime(),
                          },
                        ]
                      : [];
                  }),
                  ineligibleCandidateIds
                ),
              },
            },
            election.state
          );
          if (counted.totalSeats !== totalSeats)
            throw new Error(
              "Japan mixed election capacity does not match its frozen district/list map"
            );
          const seatsEstimate: Record<string, number> = Object.fromEntries(
            ranked.map((candidate) => [candidate.id, counted.seatsByCandidate[candidate.id] ?? 0])
          );
          if (
            Object.keys(counted.seatsByCandidate).some((id) => !candidateMap.has(id)) ||
            Object.values(seatsEstimate).some((seats) => !Number.isSafeInteger(seats) || seats < 0)
          )
            throw new Error("Japan mixed count allocated seats to an unavailable candidate");
          return {
            isMultiSeat: true,
            authoritativeSeats: counted.totalSeats,
            seatsEstimate,
            winners: Object.entries(seatsEstimate).filter(([, seats]) => seats > 0) as [
              string,
              number,
            ][],
            losers: Object.entries(seatsEstimate)
              .filter(([, seats]) => seats === 0)
              .map(([id]) => id),
          };
        })()
      : null;
    // The opt-in ranked count seats individual people, not aggregate seat blocks.
    const { isMultiSeat, seatsEstimate, winners, losers } = prStvResult
      ? {
          isMultiSeat: true,
          seatsEstimate: prStvResult.seats,
          winners: prStvResult.elected.map((id): [string, number] => [id, 1]),
          losers: ranked.filter((c) => !prStvResult.seats[c.id]).map((c) => c.id),
        }
      : (bgOrdinaryAllocation ??
        bgAllocation ??
        japanMixedAllocation ??
        huAllocation ??
        applyLegacySeatFloor(
          districted ??
            allocateSeats(
              election.electionType,
              election.state,
              totalSeats,
              ranked,
              totalVotesCast,
              houseSeats,
              // National Front chambers: the quota decides the party split, not the
              // vote. Undefined for every non-bloc-list country, so their allocation
              // is byte-identical.
              runtimeBlocQuota?.shares,
              commonsSeats,
              election.countryId ?? "US",
              allocationMethod
            ),
          ranked,
          election.conversionTerms
        ));

    if (isMultiSeat) {
      if (isSpecialCommonsElection(election.electionType)) {
        // ADDITIVE seating (#860): a by-election fills only its claimed
        // vacancies. Remove holder-less `commons` rows (the tombstones the
        // watcher recorded vacancies for) up to the seats this race filled,
        // and leave every seated MP untouched. Sitting MPs keep their rows;
        // the winner loop below inserts fresh rows for the filled seats.
        const seatsFilled = winners.reduce((n, [, s]) => n + s, 0);
        if (seatsFilled > 0) {
          const vacantRows = await db
            .collection<ElectedOfficial>("electedOfficials")
            .find(
              {
                officeType: "commons",
                state: election.state,
                ...(election.countryId ? { countryId: election.countryId } : {}),
                characterId: null,
                nppId: null,
              },
              { projection: { _id: 1 }, sort: { _id: 1 }, limit: seatsFilled }
            )
            .toArray();
          if (vacantRows.length > 0) {
            await db
              .collection<ElectedOfficial>("electedOfficials")
              .deleteMany({ _id: { $in: vacantRows.map((r) => r._id) } });
          }
        }
      } else {
        await db
          .collection<ElectedOfficial>("electedOfficials")
          .deleteMany(multiSeatOfficialFilter(election));
      }
      // Class-scoped multi-seat chambers (JP Sangiin): the filter above keys on
      // chamberClass, so councillors seeded WITHOUT a class are invisible to it
      // — every class election inserted winners beside the seeded roster and
      // the chamber accumulated without bound (measured 54% overfull). Mirror
      // of the single-winner classless-retirement below: retire as many
      // classless legacy rows as seats this election filled, oldest first, so
      // the chamber converges to its real size as classes cycle.
      const multiSeatClass = getChamberClass(election);
      if (multiSeatClass) {
        const seatsFilled = winners.reduce((n, [, s]) => n + s, 0);
        if (seatsFilled > 0) {
          const legacyRows = await db
            .collection<ElectedOfficial>("electedOfficials")
            .find(
              {
                officeType: officeKeyForElectionType(election.electionType, election.countryId),
                state: election.state,
                ...(election.countryId ? { countryId: election.countryId } : {}),
                $and: [{ senateClass: { $exists: false } }, { chamberClass: { $exists: false } }],
              },
              { projection: { _id: 1 }, sort: { electedAt: 1 }, limit: seatsFilled }
            )
            .toArray();
          if (legacyRows.length > 0) {
            await db
              .collection<ElectedOfficial>("electedOfficials")
              .deleteMany({ _id: { $in: legacyRows.map((r) => r._id) } });
          }
        }
      }
    }

    const officeAnalytics: Array<{
      officeType: string;
      transitionType: "gained" | "left" | "lost";
      partyId: string;
      careerStage: number;
      nationId: string;
    }> = [];

    // For generic single-seat elections, clear the incumbent's currentOffice if
    // they are not the winner. This includes incumbents who do not run again.
    const singleSeatTypes = ["governor", "senate", "uachtaran"];
    if (singleSeatTypes.includes(election.electionType) && winners.length > 0) {
      const winnerCandidate = candidateMap.get(winners[0][0]);

      // Build filter for finding the incumbent
      const incumbentFilter: Record<string, unknown> = {
        officeType: election.electionType,
        state: election.state,
      };
      if (election.electionType === "senate" && election.senateClass) {
        incumbentFilter.senateClass = election.senateClass;
      }

      const incumbent = await db
        .collection<ElectedOfficial>("electedOfficials")
        .findOne(incumbentFilter);

      if (incumbent) {
        const incumbentCharId = incumbent.characterId?.toString();
        const incumbentNppId = incumbent.nppId?.toString();
        const winnerCharId = winnerCandidate?.characterId?.toString();
        const winnerNppId = winnerCandidate?.nppId?.toString();
        const isSamePerson =
          (incumbentCharId && incumbentCharId === winnerCharId) ||
          (incumbentNppId && incumbentNppId === winnerNppId);

        if (!isSamePerson) {
          // Build currentOffice filter for character/NPP update
          const officeFilter: Record<string, unknown> = {
            "currentOffice.type": election.electionType,
            "currentOffice.state": election.state,
          };
          if (election.electionType === "senate" && election.senateClass) {
            officeFilter["currentOffice.senateClass"] = election.senateClass;
          }

          if (incumbent.characterId) {
            await db
              .collection<Character>("characters")
              .updateOne(
                { _id: incumbent.characterId, ...officeFilter },
                { $set: { currentOffice: null, updatedAt: now } }
              );
            officeAnalytics.push({
              officeType: incumbent.officeType,
              transitionType: "lost",
              partyId: incumbent.party ?? "unknown",
              careerStage: 0,
              nationId: election.countryId ?? "US",
            });
            console.log(
              `[Turn] Cleared currentOffice for character ${incumbent.characterName} ` +
                `(${election.electionType}/${election.state}${election.senateClass ? ` Class ${election.senateClass}` : ""}) — did not win re-election`
            );
          }
          if (incumbent.nppId) {
            await db
              .collection<NPP>("npps")
              .updateOne(
                { _id: incumbent.nppId, ...officeFilter },
                { $set: { currentOffice: null, updatedAt: now } }
              );
            console.log(
              `[Turn] Cleared currentOffice for NPP ${incumbent.characterName} ` +
                `(${election.electionType}/${election.state}${election.senateClass ? ` Class ${election.senateClass}` : ""}) — did not win re-election`
            );
          }
        }
      }
    }

    // ── Pre-fetch character/NPP data for winners and losers ─────────────
    // NOTE: These lookups return pre-mutation snapshots. In-loop code that
    // only reads immutable fields (e.g. userId for notifications) is safe.
    // Fields mutated during the loop (e.g. currentOffice) should not be
    // trusted from this cache — use fresh DB reads if needed.
    const allCandidateCharIds = candidates
      .filter((c): c is typeof c & { characterId: ObjectId } => !c.isNPP && !!c.characterId)
      .map((c) => c.characterId);
    const allCandidateNppIds = candidates
      .filter((c): c is typeof c & { nppId: ObjectId } => !!c.isNPP && !!c.nppId)
      .map((c) => c.nppId);

    const [prefetchedChars, prefetchedNpps] = await Promise.all([
      allCandidateCharIds.length > 0
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: allCandidateCharIds } })
            .toArray()
        : Promise.resolve([]),
      allCandidateNppIds.length > 0
        ? db
            .collection<NPP>("npps")
            // Seat resolution reads the office, never the 30KB stance map.
            .find(
              { _id: { $in: allCandidateNppIds }, retiredAt: null },
              { projection: { "policies.domainPositions": 0 } }
            )
            .toArray()
        : Promise.resolve([]),
    ]);
    const charLookup = new Map(prefetchedChars.map((c) => [c._id.toString(), c]));
    const nppLookup = new Map(prefetchedNpps.map((n) => [n._id.toString(), n]));
    const winnerNotifInputs: NotificationInput[] = [];
    const loserNotifInputs: NotificationInput[] = [];
    const winnerAnalytics: Array<{
      accountId?: string;
      electionId: string;
      electionType: string;
      partyId: string;
      seatCount: number;
      voteSharePct: number;
      marginPct: number;
      incumbent: boolean;
      nationId: string;
      turn: number;
      winnerOrdinal: number;
    }> = [];
    const rankedVotes = Object.entries(effectiveVotes).sort((a, b) => b[1] - a[1]);

    for (const [winnerOrdinal, [candidateId, seats]] of winners.entries()) {
      const candidate = candidateMap.get(candidateId);
      if (!candidate) continue;

      let officeType: OfficeType;
      switch (election.electionType) {
        case "senate":
          officeType = {
            type: "senate",
            state: election.state,
            senateClass: election.senateClass,
          };
          break;
        case "governor":
        case "special_governor":
          // By-election winners seat as regular governors — same office, they
          // serve out the remainder of the term until the next regular cycle.
          officeType = { type: "governor", state: election.state };
          break;
        case "house":
          officeType = { type: "house", state: election.state, seatsHeld: seats };
          break;
        case "stateSenate":
          officeType = { type: "stateSenate", state: election.state, seatsHeld: seats };
          break;
        case "commons":
        case "snap_commons":
        case "special_commons":
          // Snap and by-election winners become regular Commons MPs — same
          // seat, same officeType. By-election winners serve out the remainder
          // of the vacated term until the next regular cycle.
          officeType = { type: "commons", state: election.state, seatsHeld: seats };
          break;
        case "regionalCouncil":
          officeType = { type: "regionalCouncil", state: election.state, seatsHeld: seats };
          break;
        case "shugiin":
        case "snap_shugiin":
          // Snap winners become regular Shūgiin members — same seat, same officeType.
          officeType = { type: "shugiin", state: election.state, seatsHeld: seats };
          break;
        case "sangiin":
          officeType = {
            type: "sangiin",
            state: election.state,
            seatsHeld: seats,
            chamberClass: election.chamberClass,
          };
          break;
        case "npcDelegate":
          officeType = { type: "npcDelegate", state: election.state, seatsHeld: seats };
          break;
        case "peoplesCongress":
          officeType = { type: "peoplesCongress", state: election.state, seatsHeld: seats };
          break;
        default:
          // Persist the same country-specific office key used by the official
          // row. A chamber key such as BG nationalAssembly is not itself the
          // holder's assemblyDeputy office type.
          officeType = {
            type: officeKeyForElectionType(election.electionType, election.countryId),
            state: election.state,
            seatsHeld: seats,
          };
      }

      if (candidate.isNPP && candidate.nppId) {
        // Clear previous position from electedOfficials if held a different office
        const npp = nppLookup.get(candidate.nppId.toString());
        officeType = carryForwardCommonsConstituency(officeType, npp?.currentOffice ?? null);
        if (npp?.currentOffice) {
          const currentOffice = npp.currentOffice;
          const sameType = currentOffice.type === officeType.type;
          const currentState = "state" in currentOffice ? currentOffice.state : undefined;
          const newState = "state" in officeType ? officeType.state : undefined;
          const sameState = currentState === newState;
          const currentSenateClass =
            "senateClass" in currentOffice ? currentOffice.senateClass : undefined;
          const sameSenateClass =
            election.electionType !== "senate" || currentSenateClass === election.senateClass;
          const currentChamberClass =
            "chamberClass" in currentOffice ? currentOffice.chamberClass : undefined;
          const sameChamberClass =
            election.electionType !== "sangiin" || currentChamberClass === election.chamberClass;
          const isSameSeat = sameType && sameState && sameSenateClass && sameChamberClass;

          if (!isSameSeat) {
            await db.collection<ElectedOfficial>("electedOfficials").updateMany(
              {
                nppId: candidate.nppId,
                officeType: { $nin: [...getExecutiveOfficeKeys()] },
              },
              {
                $set: {
                  nppId: undefined,
                  characterName: undefined,
                  party: undefined,
                  isNPP: false,
                  updatedAt: now,
                } as Partial<ElectedOfficial>,
                // Multi-seat blocs (commons/bundestag/seanad) carry seatsHeld.
                // Vacating only nulls the holder identity, so without this the
                // seat count survives as a phantom `party:null seatsHeld>0`
                // orphan that the seat tallies skip — silently deleting the
                // party's representation. Clear it so vacancy = absence.
                $unset: { seatsHeld: "" },
              }
            );
            if (
              currentOffice.type === "senate" &&
              (currentSenateClass === 1 || currentSenateClass === 2 || currentSenateClass === 3)
            ) {
              await notifyGovernorOfSenateVacancy(db, currentState, currentSenateClass);
            }
            console.log(
              `[Turn] NPP ${candidate.characterName} vacated ${currentOffice.type}${currentSenateClass ? ` Class ${currentSenateClass}` : ""} (${currentState}) for new ${officeType.type}${election.senateClass ? ` Class ${election.senateClass}` : ""} (${newState})`
            );
          }
        }
        const nppFinalOfficeType = preserveExecutiveOffice(officeType, npp?.currentOffice ?? null);
        await db
          .collection<NPP>("npps")
          .updateOne(
            { _id: candidate.nppId },
            { $set: { currentOffice: nppFinalOfficeType, party: candidate.party, updatedAt: now } }
          );
      } else {
        // Clear previous position from electedOfficials if held a different office
        const char = charLookup.get(candidate.characterId?.toString() ?? "");
        officeType = carryForwardCommonsConstituency(officeType, char?.currentOffice ?? null);
        if (char?.currentOffice) {
          const currentOffice = char.currentOffice;
          const sameType = currentOffice.type === officeType.type;
          const currentState = "state" in currentOffice ? currentOffice.state : undefined;
          const newState = "state" in officeType ? officeType.state : undefined;
          const sameState = currentState === newState;
          const currentSenateClass =
            "senateClass" in currentOffice ? currentOffice.senateClass : undefined;
          const sameSenateClass =
            election.electionType !== "senate" || currentSenateClass === election.senateClass;
          const currentChamberClass =
            "chamberClass" in currentOffice ? currentOffice.chamberClass : undefined;
          const sameChamberClass =
            election.electionType !== "sangiin" || currentChamberClass === election.chamberClass;
          const isSameSeat = sameType && sameState && sameSenateClass && sameChamberClass;

          if (!isSameSeat) {
            await db.collection<ElectedOfficial>("electedOfficials").updateMany(
              {
                characterId: candidate.characterId,
                officeType: { $nin: [...getExecutiveOfficeKeys()] },
              },
              {
                $set: {
                  characterId: undefined,
                  characterName: undefined,
                  party: undefined,
                  isNPP: false,
                  updatedAt: now,
                } as Partial<ElectedOfficial>,
                // See NPP branch above: clear seatsHeld so a vacated multi-seat
                // bloc doesn't linger as a phantom `party:null seatsHeld>0` orphan.
                $unset: { seatsHeld: "" },
              }
            );
            if (
              currentOffice.type === "senate" &&
              (currentSenateClass === 1 || currentSenateClass === 2 || currentSenateClass === 3)
            ) {
              await notifyGovernorOfSenateVacancy(db, currentState, currentSenateClass);
            }
            if (!getExecutiveOfficeKeys().has(currentOffice.type)) {
              officeAnalytics.push({
                officeType: currentOffice.type,
                transitionType: "left",
                partyId: char.party ?? "unknown",
                careerStage: char.careerHistory?.length ?? 0,
                nationId: election.countryId ?? "US",
              });
            }
            console.log(
              `[Turn] ${candidate.characterName} vacated ${currentOffice.type}${currentSenateClass ? ` Class ${currentSenateClass}` : ""} (${currentState}) for new ${officeType.type}${election.senateClass ? ` Class ${election.senateClass}` : ""} (${newState})`
            );
          }
        }
        const charFinalOfficeType = preserveExecutiveOffice(
          officeType,
          char?.currentOffice ?? null
        );
        const careerEvent: CareerEvent = {
          type: "elected",
          office: officeType,
          officeLabel: getOfficeLabel(officeType, election.countryId),
          party: candidate.party,
          partyCountryId: election.countryId,
          electionId: election._id.toString(),
          date: now,
        };
        await db.collection<Character>("characters").updateOne(
          { _id: candidate.characterId },
          {
            $set: { currentOffice: charFinalOfficeType, updatedAt: now },
            $push: { careerHistory: careerEvent },
          }
        );
      }

      // Snap winners store as regular officials — normalize snap_commons → commons,
      // snap_shugiin → shugiin. All downstream queries look for the regular type.
      const officialOfficeKey = officeKeyForElectionType(election.electionType, election.countryId);
      const officialFilter: Record<string, unknown> = {
        officeType: officialOfficeKey,
        state: election.state,
      };
      if (election.electionType === "senate" && election.senateClass) {
        officialFilter.senateClass = election.senateClass;
      }
      if (election.electionType === "sangiin" && election.chamberClass) {
        officialFilter.chamberClass = election.chamberClass;
      }

      const officialDoc: Partial<ElectedOfficial> = {
        officeType: officialOfficeKey as ElectedOfficial["officeType"],
        countryId: election.countryId,
        state: election.state,
        isAppointment: false,
        ...(election.senateClass ? { senateClass: election.senateClass } : {}),
        ...(election.electionType === "sangiin" && election.chamberClass
          ? { chamberClass: election.chamberClass }
          : {}),
        ...(isMultiSeat ? { seatsHeld: seats } : {}),
        ...("constituency" in officeType && officeType.constituency
          ? { constituency: officeType.constituency }
          : {}),
        ...("constituencyId" in officeType && officeType.constituencyId
          ? { constituencyId: officeType.constituencyId }
          : {}),
        characterId: candidate.isNPP ? null : candidate.characterId,
        characterName: candidate.characterName,
        party: candidate.party,
        isNPP: candidate.isNPP ?? false,
        nppId: candidate.nppId ?? undefined,
        electedAt: now,
        updatedAt: now,
      };

      if (!isMultiSeat) {
        // Delete all existing officials for this seat before writing the winner.
        // The upsert pattern only updated the first matching record, leaving any
        // admin-appointed duplicates in place. deleteMany + insertOne mirrors the
        // multi-seat pattern and prevents stale-admin-appointments accumulation.
        await db.collection<ElectedOfficial>("electedOfficials").deleteMany(officialFilter);

        // Seat-class scoping makes the filter above blind to incumbents seeded
        // WITHOUT a class. Bootstrap seats the historical chamber with no
        // senateClass, so a class-3 election deleted nothing and simply added a
        // senator beside the sitting one: measured at turn 150, the US Senate
        // held 128 members for a 96-seat chamber, with California on 8 seats and
        // 50 members still carrying a null party from seed day. Retire one
        // classless incumbent per seat filled, oldest first, so the chamber
        // converges to its real size as elections cycle rather than growing
        // without bound.
        if (election.senateClass || election.chamberClass) {
          const legacyFilter: Record<string, unknown> = {
            officeType: officialOfficeKey,
            state: election.state,
            ...(election.countryId ? { countryId: election.countryId } : {}),
            $and: [{ senateClass: { $exists: false } }, { chamberClass: { $exists: false } }],
          };
          const legacy = await db
            .collection<ElectedOfficial>("electedOfficials")
            .findOne(legacyFilter, { sort: { electedAt: 1 } });
          if (legacy) {
            await db.collection<ElectedOfficial>("electedOfficials").deleteOne({ _id: legacy._id });
          }
        }
      }
      await db.collection<ElectedOfficial>("electedOfficials").insertOne({
        _id: new ObjectId(),
        createdAt: now,
        ...officialDoc,
      } as ElectedOfficial);

      if (!candidate.isNPP) {
        const char = charLookup.get(candidate.characterId?.toString() ?? "");
        if (char) {
          const winnerVotes = effectiveVotes[candidateId] ?? 0;
          const runnerVotes = rankedVotes.find(([id]) => id !== candidateId)?.[1] ?? 0;
          const officeKey = officeKeyForElectionType(election.electionType, election.countryId);
          const incumbentOffice = char.currentOffice;
          const incumbent =
            !!incumbentOffice &&
            incumbentOffice.type === officeKey &&
            (!("state" in incumbentOffice) || incumbentOffice.state === election.state);
          winnerAnalytics.push({
            accountId: char.userId?.toString(),
            electionId: election._id.toString(),
            electionType: election.electionType,
            partyId: candidate.party,
            seatCount: seats,
            voteSharePct: totalVotesCast > 0 ? (winnerVotes / totalVotesCast) * 100 : 0,
            marginPct:
              totalVotesCast > 0 ? ((winnerVotes - runnerVotes) / totalVotesCast) * 100 : 0,
            incumbent,
            nationId: election.countryId ?? "US",
            turn: currentTurn,
            winnerOrdinal,
          });
          if (!incumbent) {
            officeAnalytics.push({
              officeType: officeKey,
              transitionType: "gained",
              partyId: candidate.party,
              careerStage: (char.careerHistory?.length ?? 0) + 1,
              nationId: election.countryId ?? "US",
            });
          }
          const seatsLabel = isMultiSeat ? ` (${seats} seat${seats > 1 ? "s" : ""})` : "";
          const typeLabel =
            ELECTION_TYPE_SHORT_LABEL[election.electionType] ?? election.electionType;
          winnerNotifInputs.push({
            userId: char.userId,
            type: "general_win",
            title: `Elected — ${typeLabel} (${election.state})`,
            message: `Congratulations! You won the ${typeLabel} general election in ${election.state}${seatsLabel}.`,
            metadata: {
              electionId: election._id.toString(),
              state: election.state,
              electionType: election.electionType,
            },
          });
          try {
            const { resolveUserIdFromCharacter } = await import("@/lib/achievements");
            const { checkElectionWinAchievements } = await import("@/lib/achievements/triggers");
            const candUserId = await resolveUserIdFromCharacter(candidate.characterId);
            if (candUserId) {
              await checkElectionWinAchievements(
                candUserId,
                candidate.characterId,
                election.electionType
              );
            }
          } catch (e) {
            console.error("Achievement check failed:", e);
          }
        }
      }

      // Collect outcome for aggregated news
      newsOutcomes.push({
        electionType: election.electionType,
        state: election.state,
        countryId: election.countryId ?? "US",
        winnerName: candidate.characterName,
        winnerParty: candidate.party,
        isPlayer: !candidate.isNPP,
      });
    }

    await createNotifications(winnerNotifInputs);

    // Scope loser-vacate matching by chamberClass for sangiin so losing a Class 1 race
    // doesn't vacate a Class 2 seat held by the same character.
    const loserOfficeMatch: Record<string, unknown> = {
      "currentOffice.type": election.electionType,
      "currentOffice.state": election.state,
    };
    if (election.electionType === "sangiin" && election.chamberClass) {
      loserOfficeMatch["currentOffice.chamberClass"] = election.chamberClass;
    }

    for (const candidateId of losers) {
      const candidate = candidateMap.get(candidateId);
      if (!candidate) continue;

      if (candidate.isNPP && candidate.nppId) {
        await db
          .collection<NPP>("npps")
          .updateOne(
            { _id: candidate.nppId, ...loserOfficeMatch },
            { $set: { currentOffice: null, updatedAt: now } }
          );
      } else {
        // Vacate office if the loser currently holds this seat
        await db
          .collection<Character>("characters")
          .updateOne(
            { _id: candidate.characterId, ...loserOfficeMatch },
            { $set: { currentOffice: null, updatedAt: now } }
          );
        // Record the loss in career history (always, regardless of incumbency)
        const lostOffice: OfficeType =
          election.electionType === "sangiin"
            ? { type: "sangiin", state: election.state, chamberClass: election.chamberClass }
            : { type: election.electionType, state: election.state };
        await db.collection<Character>("characters").updateOne(
          { _id: candidate.characterId },
          {
            $push: {
              careerHistory: {
                type: "lost_election",
                office: lostOffice,
                officeLabel: getOfficeLabel(lostOffice, election.countryId),
                party: candidate.party,
                partyCountryId: election.countryId,
                electionId: election._id.toString(),
                date: now,
              } as CareerEvent,
            },
          }
        );
        const char = charLookup.get(candidate.characterId?.toString() ?? "");
        if (char) {
          const heldOffice = char.currentOffice;
          if (
            heldOffice?.type ===
              officeKeyForElectionType(election.electionType, election.countryId) &&
            (!("state" in heldOffice) || heldOffice.state === election.state)
          ) {
            officeAnalytics.push({
              officeType: heldOffice.type,
              transitionType: "lost",
              partyId: candidate.party,
              careerStage: char.careerHistory?.length ?? 0,
              nationId: election.countryId ?? "US",
            });
          }
          const typeLabel =
            ELECTION_TYPE_SHORT_LABEL[election.electionType] ?? election.electionType;
          loserNotifInputs.push({
            userId: char.userId,
            type: "general_loss",
            title: `Election Lost — ${typeLabel} (${election.state})`,
            message: `You did not win the ${typeLabel} general election in ${election.state}. Better luck next cycle!`,
            metadata: {
              electionId: election._id.toString(),
              state: election.state,
              electionType: election.electionType,
            },
          });
        }
      }
    }

    await createNotifications(loserNotifInputs);

    await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
      { electionId: election._id },
      {
        $set: {
          seatsEstimate,
          finalized: true,
          updatedAt: now,
          resolvedAtTurn: currentTurn,
          resolvedSeatHolders: winners.map(([candidateId, seats]) => {
            const candidate = candidateMap.get(candidateId)!;
            return {
              identity: `${candidate.isNPP ? "npp" : "player"}:${candidate.isNPP ? candidate.nppId : candidate.characterId}`,
              party: candidate.party,
              seats,
              seatSource: "direct" as const,
            };
          }),
          resolvedTotalSeats: winners.reduce((sum, [, seats]) => sum + seats, 0),
          ...(prStvResult ? { prStvResult } : {}),
          resolutionPath: prStvResult
            ? "pr_stv"
            : bgOrdinaryAllocation
              ? "bg_ordinary_national"
              : districted
                ? "districted_house"
                : runtimeBlocQuota
                  ? "bloc_list"
                  : election.countryId === "DE" &&
                      (election.electionType === "bundestag" ||
                        election.electionType === "snap_bundestag")
                    ? "ams_direct"
                    : isMultiSeat
                      ? "hare_quota"
                      : "single_winner",
        },
      }
    );

    const winnerCandidateIds = new Set(winners.map(([id]) => id));
    const loserCandidateIds = new Set(losers);
    await db
      .collection("electionCandidates")
      .updateMany(
        { _id: { $in: candidateIds.map((id) => new ObjectId(id)) } },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );

    // Root-cause guard: a character/NPP who just won a seat must not remain an
    // active candidate in any OTHER concurrent race. A lingering candidacy
    // (e.g. a second filing, or auto-reentry into a future cycle) would
    // otherwise resolve later and seat them into a second office they should
    // not hold — the failure mode that produced the IL phantom senator.
    const seatedCharIds: ObjectId[] = [];
    const seatedNppIds: ObjectId[] = [];
    for (const [candidateId] of winners) {
      const winnerCandidate = candidateMap.get(candidateId);
      if (!winnerCandidate) continue;
      if (winnerCandidate.isNPP) {
        if (winnerCandidate.nppId) seatedNppIds.push(winnerCandidate.nppId);
      } else if (winnerCandidate.characterId) {
        seatedCharIds.push(winnerCandidate.characterId);
      }
    }
    const seatedIdentityOr: Record<string, unknown>[] = [];
    if (seatedCharIds.length > 0) seatedIdentityOr.push({ characterId: { $in: seatedCharIds } });
    if (seatedNppIds.length > 0) seatedIdentityOr.push({ nppId: { $in: seatedNppIds } });
    if (seatedIdentityOr.length > 0) {
      await db
        .collection<ElectionCandidate>("electionCandidates")
        .updateMany(
          { electionId: { $ne: election._id }, status: "active", $or: seatedIdentityOr },
          { $set: { status: "withdrawn", withdrawnAt: now } }
        );
    }

    // Clean up campaigns (primarily relevant for presidential; no-op for other types)
    await db.collection("campaigns").deleteMany({ electionId: election._id });

    // ── Presence refresh ───────────────────────────────────────────────────
    // Every party that fielded a candidate in this state-level race may now
    // have presence (won a seat) or lost it (last seat fell). Refresh the
    // hasPresence flag for each participating party.
    if (election.state) {
      const participatingParties = new Set<string>();
      const winnerIds = winners.map(([id]) => id);
      for (const candidateId of [...winnerIds, ...losers]) {
        const candidate = candidateMap.get(candidateId);
        if (candidate?.party) participatingParties.add(candidate.party);
      }
      for (const partyId of participatingParties) {
        await updatePartyPresence(db, election.state, partyId);
      }
    }

    const politicianHistory = updatePoliticianPagesAfterElection(
      db,
      election,
      candidateIds,
      tally,
      winnerCandidateIds,
      loserCandidateIds,
      seatsEstimate,
      now
    );
    if (isPrStv) await politicianHistory;
    else
      politicianHistory.catch((err) =>
        logger.error("Turn", "Failed to update politician pages", err)
      );

    console.log(
      `[Turn] Election ${election._id} (${election.electionType}/${election.state}) resolved — ` +
        `${winnerCandidateIds.size} winner(s), ${candidateIds.length - winnerCandidateIds.size} loser(s)`
    );

    if (election.electionType === "house") {
      await spawnHouseElection(db, election, now);
      await triggerLeadershipElectionsAfterChamberVote(db, "house", now);
    }
    if (election.electionType === "senate") {
      await triggerLeadershipElectionsAfterChamberVote(db, "senate", now);
    }
    // Sweep stale currentOffice for any multi-seat election type — losers and
    // non-runners who still claim this constituency get cleared. Skipped for
    // Commons by-elections (#860): the rest of the delegation was not on the
    // ballot, so sitting MPs keep their seats and their currentOffice.
    if (
      MULTI_SEAT_TYPES.has(election.electionType) &&
      !isSpecialCommonsElection(election.electionType) &&
      election.state
    ) {
      await sweepStaleOffice(
        db,
        election.electionType,
        election.state,
        now,
        getChamberClass(election),
        { turn: currentTurn, nationId: election.countryId }
      );
    }
    // Spawn next cycle for election types with dedicated respawn functions
    // (JP shugiin/sangiin are respawned by ensureJPElections in perpetualElections)
    if (isCommonsGeneralElection(election.electionType) && election.state) {
      await spawnCommonsElection(db, election, now);
    }
    await recordJapanShugiinRegionalCapacity(db, election, currentTurn, now);
    await db
      .collection<Election>("elections")
      .updateOne(
        { _id: election._id },
        { $set: { status: "resolved" satisfies ElectionStatus, updatedAt: now } }
      );
    await Promise.all(
      winnerAnalytics
        .filter(
          () =>
            !(
              election.countryId === "DE" &&
              getElectionMethod(election.countryId, election.electionType) === "ams" &&
              (election.electionType === "bundestag" || election.electionType === "snap_bundestag")
            )
        )
        .map((winner) =>
          captureElectionWon({
            db,
            accountId: winner.accountId,
            electionId: winner.electionId,
            electionType: winner.electionType,
            partyId: winner.partyId,
            seatCount: winner.seatCount,
            voteSharePct: winner.voteSharePct,
            marginPct: winner.marginPct,
            incumbent: winner.incumbent,
            nationId: winner.nationId,
            turn: winner.turn,
            winnerOrdinal: winner.winnerOrdinal,
          })
        )
    );
    await Promise.all(
      officeAnalytics.map((transition) =>
        captureOfficeTransition({
          db,
          officeType: transition.officeType,
          transitionType: transition.transitionType,
          partyId: transition.partyId,
          selectionMethod: "election",
          tenureTurns: 0,
          careerStage: transition.careerStage,
          nationId: transition.nationId,
          turn: currentTurn,
        })
      )
    );
    await voidDebateSessionsForElection(db, election._id, now);

    await reconcileGermanElection(db, election, now);

    // ── CN NPC Standing Committee Chairman auto-open ──────────────────────────
    // The NPC is filled across multiple regional `npcDelegate` elections. Once
    // the final one of this cycle resolves, open a Chairman election for the
    // newly-seated chamber — parity with the US Speaker / DE Bundestagspräsident
    // auto-open. The opener is idempotent, so an early trigger is harmless.
    if (election.countryId === "CN" && election.electionType === "npcDelegate") {
      try {
        const remaining = await db.collection<Election>("elections").countDocuments({
          countryId: "CN",
          electionType: "npcDelegate",
          cycle: election.cycle,
          status: { $ne: "resolved" satisfies ElectionStatus },
          _id: { $ne: election._id },
        });
        if (remaining === 0) {
          const { triggerNpcscChairElectionAfterReconcile } =
            await import("@/lib/congress/npcscChair/openElection");
          await triggerNpcscChairElectionAfterReconcile(db, now);
          const { triggerCppccChairElectionAfterReconcile } =
            await import("@/lib/congress/cppccChair/openElection");
          await triggerCppccChairElectionAfterReconcile(db, now);
        }
      } catch (err) {
        logger.error("Turn", `CN chair auto-open failed (cycle ${election.cycle})`, err);
      }
    }

    // ── RU Supreme Soviet convocation trigger ────────────────────────────────
    // Same remaining===0 last-of-cycle detection as the CN hook above, but the
    // RU actions are DESTRUCTIVE (formation reset), so an explicit cycle guard
    // inside handleRuConvocationReset makes the trigger idempotent: only the
    // first resolver of a new cycle resets the government (spec §2.4).
    const regularRuType = election.electionType.startsWith("snap_")
      ? election.electionType.slice(5)
      : election.electionType;
    if (
      election.countryId === "RU" &&
      [
        "supremeSovietDeputy",
        "unionCongressDeputy",
        "congressDeputy",
        "congressOfPeoplesDeputies",
        "dumaDeputy",
        "stateDuma",
      ].includes(regularRuType)
    ) {
      try {
        const remaining = await db.collection<Election>("elections").countDocuments({
          countryId: "RU",
          electionType: election.electionType,
          cycle: election.cycle,
          status: { $in: ["upcoming", "active", "completed"] satisfies ElectionStatus[] },
          _id: { $ne: election._id },
        });
        if (remaining === 0) {
          const { handleRuConvocationReset } = await import("@/lib/turn/ruConvocation");
          await handleRuConvocationReset(db, election.cycle ?? 1, now, election.electionType);
        }
      } catch (err) {
        logger.error("Turn", `RU convocation trigger failed (cycle ${election.cycle})`, err);
      }
    }

    return { resolved: true, newsOutcomes };
  } finally {
    await db
      .collection<Election>("elections")
      .updateOne({ _id: election._id }, { $set: { resolving: false, updatedAt: now } });
  }
}
