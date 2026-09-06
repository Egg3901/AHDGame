/**
 * GET /api/admin/debug/primary-projection?partyId=...
 *
 * Read-only diagnostic for the presidential primary projection pipeline. Returns
 * everything the per-state primary page and overview standings derive from a
 * single canonical source so admins can verify they agree:
 *
 *   - per-state vote source (actual / projected / none)
 *   - per-state vote totals + share + projected delegate allocation
 *   - national vote totals + share (sum across states)
 *   - national delegate totals + share
 *   - candidate roster + key stats used by the projection
 *
 * Safe to call any time. Does not mutate state.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PoliticalParty,
  Character,
  NPP,
  State,
  StateDemographics,
  StatePartyOrg,
  DemographicCategory,
} from "@/lib/db/types";
import { projectPrimaryByState } from "@/lib/primaryProjection";
import { loadRegionalBonusMaps } from "@/lib/primaryRegionalBonusLoader";
import { fetchEnrichedCandidates } from "@/lib/electionEngine";
import { summarizePrimaryProjection } from "@/lib/elections/presidentialPrimaryDisplay";
import {
  resolvePartyFamily,
  getTotalDelegatesForFamily,
  getDefaultPrimaryAllocation,
  GOP_HYBRID_STATES,
  type PrimaryCalendarFamily,
} from "@/lib/constants/primaryCalendar";
import { ELECTORAL_VOTE_UNITS } from "@/lib/constants/states";

const ALL_STATE_IDS = [...new Set(ELECTORAL_VOTE_UNITS.map((u) => u.stateId))];

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const url = new URL(req.url);
    const partyIdParam = url.searchParams.get("partyId");
    const db = await getDb();

    const election = await db.collection<Election>("elections").findOne({
      electionType: "president",
      countryId: "US",
      status: "active",
    });
    if (!election) {
      return NextResponse.json({
        ok: false,
        error: "no-active-presidential-election",
        message:
          "No active US presidential election was found. The debugger requires an active race.",
      });
    }

    // Resolve party — accept sequentialId or abbreviation
    let party: PoliticalParty | null = null;
    if (partyIdParam) {
      const seq = Number(partyIdParam);
      if (Number.isFinite(seq)) {
        party = await db
          .collection<PoliticalParty>("politicalParties")
          .findOne({ countryId: "US", sequentialId: seq });
      }
      if (!party) {
        party = await db
          .collection<PoliticalParty>("politicalParties")
          .findOne({ countryId: "US", abbreviation: partyIdParam });
      }
    }

    // List parties that actually have active candidates so the UI can populate
    // the dropdown without separately calling another endpoint.
    const partyKeysWithCandidates = (await db
      .collection<ElectionCandidate>("electionCandidates")
      .distinct("party", { electionId: election._id, status: "active" })) as string[];
    const candidateParties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: "US", sequentialId: { $in: partyKeysWithCandidates.map(Number) } })
      .project<{ sequentialId: number; abbreviation: string; name: string }>({
        sequentialId: 1,
        abbreviation: 1,
        name: 1,
      })
      .toArray();
    const partyOptions = candidateParties.map((p) => ({
      sequentialId: p.sequentialId,
      abbreviation: p.abbreviation,
      name: p.name,
    }));

    if (!party) {
      return NextResponse.json({
        ok: true,
        electionId: election._id.toString(),
        currentTurn: null,
        partyOptions,
        party: null,
        warning: partyIdParam
          ? `No party found for "${partyIdParam}".`
          : "Pass ?partyId=<sequentialId|abbreviation> to inspect a specific party's primary.",
      });
    }

    const partyKey = party.sequentialId.toString();
    const family: PrimaryCalendarFamily = resolvePartyFamily(partyKey, {
      primaryCalendar: party.primaryCalendar ?? null,
      economicPosition: party.economicPosition,
    });

    const [candidates, tally] = await Promise.all([
      db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: election._id, party: partyKey, status: "active" })
        .toArray(),
      db.collection<ElectionVoteTally>("electionVoteTallies").findOne({ electionId: election._id }),
    ]);

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        electionId: election._id.toString(),
        partyOptions,
        party: { id: partyKey, name: party.name, abbreviation: party.abbreviation },
        family,
        warning: "No active candidates in this party's primary.",
      });
    }

    // Enrichment + state/demographic loading mirrors the page so the debugger
    // sees the exact same projection inputs.
    const charIds = candidates.filter((c) => !c.isNPP).map((c) => c.characterId);
    const nppIds = candidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!);
    const [chars, npps, partyOrgs, categoriesDocs, statesDocs, demographicsDocs, enriched] =
      await Promise.all([
        charIds.length
          ? db
              .collection<Character>("characters")
              .find({ _id: { $in: charIds } })
              .toArray()
          : Promise.resolve([] as Character[]),
        nppIds.length
          ? db
              .collection<NPP>("npps")
              .find({ _id: { $in: nppIds } })
              .toArray()
          : Promise.resolve([] as NPP[]),
        db
          .collection<StatePartyOrg>("statePartyOrg")
          .find({ countryId: "US", partyId: partyKey })
          .toArray(),
        db.collection<DemographicCategory>("demographicCategories").find({}).toArray(),
        db
          .collection<State>("states")
          .find({ _id: { $in: ALL_STATE_IDS } })
          .toArray(),
        db
          .collection<StateDemographics>("stateDemographics")
          .find({ _id: { $in: ALL_STATE_IDS } })
          .toArray(),
        fetchEnrichedCandidates(candidates, { includePartyPositions: true, countryId: "US" }),
      ]);

    const charMap = new Map(chars.map((c) => [c._id.toString(), c]));
    const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));
    const stateMap = new Map(statesDocs.map((s) => [s._id as string, s]));
    const demographicsMap = new Map(demographicsDocs.map((d) => [d._id as string, d]));

    const orgMap = new Map<string, number>();
    const allocationByState: Record<string, "PR" | "WTA"> = {};
    for (const po of partyOrgs) {
      orgMap.set(`${po.stateId}_${po.partyId}`, po.organization + (po.primarySurge ?? 0));
      if (po.primaryAllocation) allocationByState[po.stateId] = po.primaryAllocation;
    }

    const candidateMeta = candidates.map((c) => {
      const homeState = c.isNPP
        ? c.nppId
          ? (nppMap.get(c.nppId.toString())?.homeState ?? null)
          : null
        : (charMap.get(c.characterId.toString())?.homeState ?? null);
      return {
        candidateId: c._id.toString(),
        isNPP: Boolean(c.isNPP),
        homeState,
        primaryCampaignState: c.primaryCampaignState ?? null,
        primaryCampaignTicks: c.primaryCampaignTicks ?? 0,
        primarySurgeUsed: c.primarySurgeUsed ?? false,
        primarySurgeBoost: c.primarySurgeBoost,
      };
    });

    const homeStateByCharacterIdProj = new Map(
      [...charMap.values()].map((c) => [c._id.toString(), c.homeState ?? null])
    );
    const homeStateByNppIdProj = new Map(
      [...nppMap.values()].map((n) => [n._id.toString(), n.homeState ?? null])
    );
    const regionalBonuses = await loadRegionalBonusMaps(db, {
      candidates,
      homeStateByCharacterId: homeStateByCharacterIdProj,
      homeStateByNppId: homeStateByNppIdProj,
    });

    const projection = projectPrimaryByState({
      candidates: enriched,
      candidateMeta,
      stateIds: ALL_STATE_IDS,
      stateMap,
      demographicsMap,
      categories: categoriesDocs,
      statePartyOrgs: orgMap,
      partyPosition: {
        economicPosition: party.economicPosition,
        socialPosition: party.socialPosition,
      },
      stateOrgByStateAndCandidate: regionalBonuses.stateOrgByStateAndCandidate,
      homeStateByCandidate: regionalBonuses.homeStateByCandidate,
    });

    const candidateIds = candidates.map((c) => c._id.toString());
    // Per-state delegate counts rescale by the active preset's EV apportionment.
    const gsForDelegates = await db
      .collection<{ _id: string; preset?: string }>("gameState")
      .findOne({ _id: "current" });
    const delegatePreset = gsForDelegates?.preset;
    const totalDelegates = getTotalDelegatesForFamily(family, delegatePreset);
    const summary = summarizePrimaryProjection({
      stateIds: ALL_STATE_IDS,
      family,
      candidateIds,
      totalDelegates,
      projectedVotesByState: projection.byState,
      actualVotesByState: tally?.primaryStateVotes?.[partyKey] ?? {},
      awardedDelegatesByState: tally?.primaryDelegatesByState?.[partyKey] ?? {},
      allocationByState: {
        ...allocationByState,
        ...(tally?.primaryAllocationByState?.[partyKey] ?? {}),
      },
      preset: delegatePreset,
    });

    // Diagnostic warnings the UI surfaces — make missing/stale data obvious
    // instead of silently rendering a 50/50 fallback.
    const warnings: string[] = [];
    const missingDemoStates = ALL_STATE_IDS.filter((s) => !demographicsMap.has(s));
    if (missingDemoStates.length > 0) {
      warnings.push(
        `Missing demographics for ${missingDemoStates.length} state(s): ${missingDemoStates.join(
          ", "
        )}. Those states are skipped by the projection — they show no winner on the map.`
      );
    }
    const missingProjStates = ALL_STATE_IDS.filter(
      (s) => Object.keys(projection.byState[s] ?? {}).length === 0
    );
    if (missingProjStates.length > 0 && missingProjStates.length !== missingDemoStates.length) {
      warnings.push(
        `Projection produced empty results for ${missingProjStates.length} state(s) beyond missing demographics.`
      );
    }
    if (candidateIds.length < 2) {
      warnings.push("Fewer than two active candidates — the primary is uncontested.");
    }
    const wavesRun = tally?.primaryWaveHistory?.length ?? 0;
    const totalActual = Object.values(summary.nationalVotesByCandidate).reduce((s, v) => s + v, 0);
    const allDelegates = Object.values(summary.delegatesByCandidate).reduce((s, v) => s + v, 0);
    if (wavesRun === 0 && allDelegates !== 0 && totalActual === 0) {
      warnings.push(
        "No waves have fired yet but delegates are non-zero — possible stale tally data."
      );
    }

    const candidatesPayload = candidates.map((c) => {
      const cid = c._id.toString();
      const charDoc = c.isNPP ? null : charMap.get(c.characterId.toString());
      const nppDoc = c.isNPP && c.nppId ? nppMap.get(c.nppId.toString()) : null;
      const meta = candidateMeta.find((m) => m.candidateId === cid)!;
      return {
        candidateId: cid,
        characterName: c.characterName,
        isNPP: Boolean(c.isNPP),
        homeState: meta.homeState ?? null,
        primaryCampaignState: meta.primaryCampaignState,
        primaryCampaignTicks: meta.primaryCampaignTicks,
        nationalInfluence: charDoc?.nationalInfluence ?? null,
        favorability: charDoc?.favorability ?? nppDoc?.favorability ?? null,
        economicPosition: charDoc?.policies?.economic ?? nppDoc?.policies?.economic ?? null,
        socialPosition: charDoc?.policies?.social ?? nppDoc?.policies?.social ?? null,
        nationalVotes: summary.nationalVotesByCandidate[cid] ?? 0,
        nationalVoteSharePct: summary.nationalVoteSharePct[cid] ?? 0,
        projectedDelegates: summary.delegatesByCandidate[cid] ?? 0,
        nationalDelegateSharePct: summary.nationalDelegateSharePct[cid] ?? 0,
      };
    });

    const tallyAlloc = tally?.primaryAllocationByState?.[partyKey] ?? {};
    const perStatePayload = summary.perState.map((s) => {
      const explicit = allocationByState[s.stateId];
      const tallyLocked = tallyAlloc[s.stateId];
      const defaultMethod = getDefaultPrimaryAllocation(s.stateId, family);
      const allocationSource: "tally" | "chair-override" | "real-world-default" | "fallback" =
        tallyLocked
          ? "tally"
          : explicit
            ? "chair-override"
            : s.allocationMethod === defaultMethod
              ? "real-world-default"
              : "fallback";
      return {
        stateId: s.stateId,
        delegatesAvailable: s.delegatesAvailable,
        allocationMethod: s.allocationMethod,
        allocationSource,
        isHybridApprox: family === "gop" && GOP_HYBRID_STATES.has(s.stateId),
        voteSource: s.voteSource,
        totalVotes: s.totalVotes,
        winnerId: s.winnerId,
        sharePctByCandidate: s.sharePctByCandidate,
        votesByCandidate: s.votesByCandidate,
        projectedDelegatesByCandidate: s.projectedDelegatesByCandidate,
        awardedDelegatesByCandidate: s.awardedDelegatesByCandidate,
      };
    });

    return NextResponse.json({
      ok: true,
      electionId: election._id.toString(),
      partyOptions,
      party: {
        id: partyKey,
        sequentialId: party.sequentialId,
        name: party.name,
        abbreviation: party.abbreviation,
        economicPosition: party.economicPosition,
        socialPosition: party.socialPosition,
      },
      family,
      totalDelegates,
      wavesRun,
      candidates: candidatesPayload,
      perState: perStatePayload,
      warnings,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
