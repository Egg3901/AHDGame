import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { recordAudit } from "@/lib/audit/recordAudit";
import { checkRateLimit, ELECTION_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { logRequest } from "@/lib/api/requestLog";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import type { Character, ElectionCandidate, PoliticalParty } from "@/lib/db/types";
import {
  canFieldExecutiveCandidate,
  canFieldLegislativeCandidate,
} from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { findBlockingActiveCandidacy } from "@/lib/elections/activeCandidacy";
import { DEFAULT_CANDIDATE_SUPPORT } from "@/lib/electionEngine/electionFormulaFactors";
import { removeWithdrawnCandidateFromTally } from "@/lib/electionEngine/tallyCleaner";
import { createInitialCampaign } from "@/lib/campaigns/createInitialCampaign";
import { isCampaignEligibleElection } from "@/lib/campaigns/isCampaignEligible";
import { getGameTime } from "@/lib/time/gameTime";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { hasReachedExecutiveTermLimit } from "@/lib/elections/executiveTermLimits";
import {
  isElectionTypeEntryBlocked,
  isNationwideDirectExecutiveElection,
} from "@/lib/elections/nationwideExecutive";
import { isActiveElectionCandidateDuplicateKey } from "@/lib/elections/duplicateKey";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/elections/[id]/enter — Enters the authenticated character into an election as a candidate.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  const start = Date.now();
  const path = new URL(request.url).pathname;
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) {
      logRequest("POST", path, 401, Date.now() - start);
      return auth.response;
    }

    const { user } = auth;
    const character = user.character;

    const limit = checkRateLimit(
      `election:${user.userId}`,
      ELECTION_LIMITS.maxRequests,
      ELECTION_LIMITS.windowMs
    );
    if (!limit.ok) {
      logRequest("POST", path, 429, Date.now() - start);
      return rateLimitResponse(limit.retryAfter);
    }

    const { id: electionId } = await params;

    const db = await getDb();

    const resolved = await resolveElectionRouteParam(db, electionId);
    if (!resolved.ok) {
      if (resolved.reason === "invalid_id") {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json({ error: "Invalid election ID" }, { status: 400 });
      }
      logRequest("POST", path, 404, Date.now() - start);
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    const election = resolved.election;
    const electionObjectId = election._id;

    // Check if election is open for entry
    if (election.status !== "upcoming" && election.status !== "active") {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json({ error: "This election is not open for entry" }, { status: 400 });
    }

    // Hard block any future race type whose resolver is not production-ready.
    // The shared set is currently empty, but this keeps an incomplete spawner
    // from exposing a filing path before its resolver ships.
    if (isElectionTypeEntryBlocked(election.electionType)) {
      logRequest("POST", path, 403, Date.now() - start);
      return NextResponse.json(
        {
          error:
            "Candidate filing is temporarily disabled for this race while its resolution mechanic is being implemented.",
        },
        { status: 403 }
      );
    }

    const { effectiveNow: now, currentTurn } = await getGameTime();
    // Turn-first (drift-immune) with Date fallback; a race with no primary
    // boundary at all is treated as "primary not ended" (entry pre-primary).
    const primaryEnded =
      typeof election.primaryEndTurn === "number"
        ? currentTurn >= election.primaryEndTurn
        : Boolean(election.primaryEndTime && now > new Date(election.primaryEndTime));
    const electionCountry = (election.countryId ?? COUNTRY_CONFIGS.US.id) as CountryId;
    // Nationwide directly-elected executive races (US president, IE uachtarán)
    // use the country code as `state` and don't follow the per-region home-state
    // restriction. Parliamentary executives (PMs, chancellors, taoisigh) are
    // chosen by their legislature and never reach this entry path.
    const isNationwideExecutive = isNationwideDirectExecutiveElection(
      election.electionType,
      election.state,
      electionCountry
    );
    const executiveTermSnapshot: Pick<Character, "careerHistory" | "executiveTermsServed"> | null =
      isNationwideExecutive
        ? await db
            .collection<Character>("characters")
            .findOne(
              { _id: character._id },
              { projection: { careerHistory: 1, executiveTermsServed: 1 } }
            )
        : null;

    // All candidates must declare during the primary phase
    if (election.primaryEndTime && primaryEnded) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json(
        { error: "The primary entry period has ended. You cannot join the race." },
        { status: 400 }
      );
    }

    // Block cross-country election entry
    const characterCountry = character.countryId ?? COUNTRY_CONFIGS.US.id;
    if (electionCountry !== characterCountry) {
      logRequest("POST", path, 403, Date.now() - start);
      return NextResponse.json(
        {
          error: `This election is for ${electionCountry} characters only. Your character belongs to ${characterCountry}.`,
        },
        { status: 403 }
      );
    }

    // One-party-state guards. The legislative gate blocks banned parties
    // and independents from any office in OPS; the executive gate further
    // restricts executive offices (premier/president/npcPremier) to the
    // ruling party only. Order matters — the broader legislative gate runs
    // first so we surface a clear "banned" / "independent" 403 before the
    // narrower executive-only message would fire.
    // Runtime governmentType so a post-Stage-4 conversion immediately
    // changes which gates apply to candidate entry.
    const electionRuntime = await getCountryState(db, electionCountry);
    const electionRuntimeConfig = { governmentType: electionRuntime.governmentType };
    if (electionRuntime.governmentType === "onePartyState") {
      const characterPartySeqId = Number.parseInt(character.party ?? "0", 10);
      const characterParty =
        Number.isFinite(characterPartySeqId) && characterPartySeqId > 0
          ? await db
              .collection<PoliticalParty>("politicalParties")
              .findOne({ countryId: electionCountry, sequentialId: characterPartySeqId })
          : null;

      if (!canFieldLegislativeCandidate(electionRuntimeConfig, characterParty)) {
        const message =
          characterParty?.regimeStatus === "banned"
            ? "Banned parties may not field candidates in this country."
            : "Independents cannot run in this country — join a recognised party first.";
        logRequest("POST", path, 403, Date.now() - start);
        return NextResponse.json({ error: message }, { status: 403 });
      }

      if (
        !canFieldExecutiveCandidate(electionRuntimeConfig, characterParty, election.electionType)
      ) {
        logRequest("POST", path, 403, Date.now() - start);
        return NextResponse.json(
          {
            error: "Only the ruling party may field a candidate for this office in this country.",
          },
          { status: 403 }
        );
      }
    }

    if (
      isNationwideExecutive &&
      hasReachedExecutiveTermLimit(
        executiveTermSnapshot ?? {
          careerHistory: character.careerHistory,
          executiveTermsServed: character.executiveTermsServed,
        },
        electionCountry
      )
    ) {
      logRequest("POST", path, 400, Date.now() - start);
      const officeLabel =
        COUNTRY_CONFIGS[electionCountry]?.officeTypes.find((o) => o.key === election.electionType)
          ?.label ?? "executive";
      return NextResponse.json(
        {
          error: `This character has already served the maximum number of ${officeLabel} terms.`,
        },
        { status: 400 }
      );
    }

    // Enforce home-state restriction — players can only run in their own state.
    // Nationwide executive races (president, uachtaran) use the country code
    // as state and are exempt from this check.
    if (!isNationwideExecutive && election.state && character.homeState !== election.state) {
      logRequest("POST", path, 403, Date.now() - start);
      return NextResponse.json(
        {
          error: `You can only run for office in your home state (${character.homeState}). This election is in ${election.state}.`,
        },
        { status: 403 }
      );
    }

    // A seated Senator may only run for re-election to the exact Senate class
    // they currently hold. They cannot abandon their class mid-term to contest
    // a different Senate seat (e.g. a Class II Senator filing for Class I or
    // Class III). Running for a non-Senate office is unaffected.
    const heldOffice = character.currentOffice;
    const heldSenateClass =
      heldOffice && heldOffice.type === "senate" && "senateClass" in heldOffice
        ? heldOffice.senateClass
        : undefined;
    if (
      election.electionType === "senate" &&
      heldSenateClass != null &&
      heldSenateClass !== election.senateClass
    ) {
      logRequest("POST", path, 403, Date.now() - start);
      return NextResponse.json(
        {
          error: `You hold the Class ${heldSenateClass} Senate seat and may only run for re-election to that seat, not Class ${election.senateClass}.`,
        },
        { status: 403 }
      );
    }

    // Check if character is already in this race (any party, including different from current)
    const existingCandidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      electionId: electionObjectId,
      characterId: character._id,
      status: "active",
    });

    if (existingCandidate) {
      // If they have an active candidacy under a different party, withdraw it first
      if (existingCandidate.party !== character.party) {
        await db
          .collection("electionCandidates")
          .updateOne(
            { _id: existingCandidate._id },
            { $set: { status: "withdrawn", withdrawnAt: new Date() } }
          );
        await removeWithdrawnCandidateFromTally(
          db,
          existingCandidate.electionId,
          existingCandidate._id.toString()
        );
      } else {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json(
          { error: "You are already entered in this race" },
          { status: 400 }
        );
      }
    }

    // Block double entry while any non-terminal election still has this character as an active
    // candidate — including `completed` elections awaiting resolution (see activeCandidacy.ts).
    const blocking = await findBlockingActiveCandidacy(db, character._id, electionObjectId);
    if (blocking) {
      const { election: conflictElection } = blocking;
      const desc = `${conflictElection.electionType} race in ${conflictElection.state}`;
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json(
        {
          error: `You are already running in the ${desc}. Withdraw first before entering a new race.`,
        },
        { status: 400 }
      );
    }

    // Carry over per-cycle throttle / one-shot gates from a prior candidacy in this
    // same election. Withdrawing and re-entering used to insert a fresh row with
    // these unset, which reset the one-rally-per-turn throttle (`lastRallyTurn`) and
    // the one-per-cycle home-state surge gate (`primarySurgeUsed`/`primarySurgeBoost`)
    // — letting a candidate re-fire a rally and re-trigger the surge every cycle. The
    // turn processor clears these at primary resolution, so carrying them forward only
    // affects a withdraw/re-enter within the same live primary.
    const priorCandidacy = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: electionObjectId, characterId: character._id })
      .sort({ enteredAt: -1 })
      .limit(1)
      .next();

    // Create the candidate entry. Support seeded at the neutral midpoint
    // per design doc §3.1 (lifecycle: written on entry, decayed each
    // turn, cleared on resolution).
    const candidateDoc: Omit<ElectionCandidate, "_id"> = {
      electionId: electionObjectId,
      countryId: electionCountry,
      characterId: character._id,
      characterName: character.name,
      party: character.party,
      status: "active",
      support: DEFAULT_CANDIDATE_SUPPORT,
      enteredAt: now,
      ...(priorCandidacy?.lastRallyTurn !== undefined
        ? { lastRallyTurn: priorCandidacy.lastRallyTurn }
        : {}),
      ...(priorCandidacy?.primarySurgeUsed !== undefined
        ? { primarySurgeUsed: priorCandidacy.primarySurgeUsed }
        : {}),
      ...(priorCandidacy?.primarySurgeBoost !== undefined
        ? { primarySurgeBoost: priorCandidacy.primarySurgeBoost }
        : {}),
    };

    let result: { insertedId: ObjectId };
    try {
      result = await db.collection("electionCandidates").insertOne(candidateDoc);
    } catch (error) {
      if (isActiveElectionCandidateDuplicateKey(error)) {
        const activeCandidate = await db
          .collection<ElectionCandidate>("electionCandidates")
          .findOne({ characterId: character._id, status: "active" });

        if (activeCandidate?.electionId.equals(electionObjectId)) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            { error: "You are already entered in this race" },
            { status: 400 }
          );
        }

        const blockingAfterRace = await findBlockingActiveCandidacy(
          db,
          character._id,
          electionObjectId
        );
        if (blockingAfterRace) {
          const { election: conflictElection } = blockingAfterRace;
          const desc = `${conflictElection.electionType} race in ${conflictElection.state}`;
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            {
              error: `You are already running in the ${desc}. Withdraw first before entering a new race.`,
            },
            { status: 400 }
          );
        }
      }

      throw error;
    }

    // Keep the slate board in sync for manually assigned player rows so the
    // party can see when a slated candidate has actually filed into the race.
    const slateCandidatesCollection = db.collection("slateCandidates") as {
      updateOne?: (
        filter: Record<string, unknown>,
        update: Record<string, unknown>
      ) => Promise<unknown>;
    };
    if (typeof slateCandidatesCollection.updateOne === "function") {
      await slateCandidatesCollection.updateOne(
        {
          electionId: electionObjectId,
          candidateType: "character",
          candidateId: character._id,
          filedAt: null,
        },
        {
          $set: {
            status: "filed",
            filedAt: now,
            respondedAt: now,
            updatedAt: now,
          },
        }
      );
    }

    // Create campaign doc immediately so fundraising / ground-game / media UI
    // works from the moment a candidate enters — but only for US presidential
    // (the only race type the Campaign Manager system covers). Idempotent: no-op
    // if a campaign already exists for this candidate + election.
    if (isCampaignEligibleElection(election)) {
      await createInitialCampaign({
        db,
        electionId: electionObjectId,
        candidateId: character._id,
        candidateIsNPP: false,
        party: character.party,
        now,
      });
    }

    try {
      const { checkElectionEntryAchievements } = await import("@/lib/achievements/triggers");
      await checkElectionEntryAchievements(new ObjectId(user.userId), character._id, election);
    } catch (e) {
      console.error("Achievement check failed:", e);
    }

    recordAudit({
      source: "api",
      action: "election.enter",
      category: "election",
      subject: {
        type: "election",
        id: electionObjectId,
        name: `${election.electionType} — ${election.state}`,
      },
      refs: { electionId: electionObjectId },
      meta: {
        candidateId: result.insertedId.toString(),
        electionType: election.electionType,
        state: election.state,
        party: character.party,
        countryId: electionCountry,
      },
      outcome: "ok",
    });

    logRequest("POST", path, 200, Date.now() - start);
    return NextResponse.json({
      success: true,
      message: `${character.name} has entered the ${election.electionType} race in ${election.state}`,
      candidateId: result.insertedId.toString(),
    });
  } catch (error) {
    logRequest("POST", path, 500, Date.now() - start);
    return handleRouteError(error);
  }
}
