import { z } from "zod";
import { isBgFoundingCampaign } from "@/lib/countries/bg/rules/foundingCampaign1990";
import {
  registerBgFoundingPlayerFiling,
  bgFoundingFilingMessages,
} from "@/lib/countries/bg/foundingPlayerFiling1990";
import { isHu1991AssemblyCampaign } from "@/lib/countries/hu/rules/assemblyCampaign1991";
import {
  registerHu1991PlayerFiling,
  hu1991FilingMessages,
} from "@/lib/countries/hu/playerFiling1991";
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
import {
  isActiveElectionCandidateDuplicateKey,
  isActiveJapanShugiinNominationDuplicateKey,
} from "@/lib/elections/duplicateKey";
import { isHuDistrictInRegion } from "@/lib/countries/hu/rules/constituencies2014";
import { validateRussianDumaPlayerFiling } from "@/lib/countries/ru/dumaPlayerFiling";
import {
  validateRussianCouncilPlayerFiling,
  registerRussianCouncilPlayerCandidate,
} from "@/lib/countries/ru/councilPlayerFiling";
import { JP_SHUGIIN_1994_CONSTITUENCIES } from "@/lib/countries/jp/data/jpShugiinConstituencies1994";
import {
  ensureJapanShugiinFilingIndexes,
  japanShugiinDistrictPartyKey,
} from "@/lib/countries/jp/elections/shugiinFilingIndexes";

const hu1991EntryBody = z
  .object({
    constituencyId: z.string().min(1).max(80).optional(),
    japanShugiinListOrder: z.number().int().min(1).max(300).optional(),
  })
  .strict();
const councilFilingErrors = {
  "already-filed": "You are already entered in this Council race.",
  "association-full": "Your association already has two player nominees in this subject.",
  "unbound-mandate": "This Council election no longer matches its ratified constitutional mandate.",
  "invalid-ballot": "This Council ballot has an invalid subject or filing schedule.",
  "filing-closed": "The Council candidate filing period has ended.",
  "invalid-residence":
    "You must live in this subject's Russian macroregion to contest this Council ballot.",
  "unregistered-association": "Join an existing unbanned Russian party or file as an independent.",
  "other-chamber-mandate": "You already hold a Duma mandate and cannot contest a Council seat.",
  "council-mandate": "You already hold a Council mandate.",
  "other-candidacy": "Withdraw your other active candidacy before entering this Council race.",
};

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
    if (character.federationPendingResidenceId !== undefined) {
      logRequest("POST", path, 403, Date.now() - start);
      return NextResponse.json(
        { error: "Choose a playable residence before entering an election." },
        { status: 403 }
      );
    }

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

    const hu1991 = isHu1991AssemblyCampaign(election) || election.hungarianModernByElection != null;
    const hu2014 =
      election.countryId === "HU" &&
      election.electionType === "nationalAssembly" &&
      election.hungarianModernAssembly?.ruleVersion === "mixed-2011-v1";
    const japanMixed =
      election.countryId === "JP" &&
      (election.electionType === "shugiin" || election.electionType === "snap_shugiin") &&
      election.japanShugiinRules?.ruleVersion === "mixed-1994-v1";
    const bgFounding = isBgFoundingCampaign(election);
    let huDistrictId: string | undefined;
    let japanDistrictId: string | undefined;
    let japanShugiinListOrder: number | undefined;
    if (hu1991 || bgFounding || hu2014 || japanMixed) {
      if (
        bgFounding &&
        election.bulgarianFoundingRound?.round !== 1 &&
        !election.bulgarianFoundingRound?.newNominationDistrictIds?.length
      )
        return NextResponse.json(
          { error: bgFoundingFilingMessages["filing-closed"] },
          { status: 403 }
        );
      if (
        hu1991 &&
        !election.hungarianModernByElection &&
        election.hungarianAssemblyRound?.round !== 1
      )
        return NextResponse.json({ error: hu1991FilingMessages["filing-closed"] }, { status: 403 });
      const text = await request.text();
      let body: unknown = {};
      try {
        if (text.trim()) body = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { error: "Invalid constituency filing request." },
          { status: 400 }
        );
      }
      const parsed = hu1991EntryBody.safeParse(body);
      if (!parsed.success)
        return NextResponse.json(
          { error: "Invalid constituency filing request." },
          { status: 400 }
        );
      huDistrictId = parsed.data.constituencyId;
      if (japanMixed) {
        japanDistrictId = parsed.data.constituencyId;
        japanShugiinListOrder = parsed.data.japanShugiinListOrder;
        if (
          (!japanDistrictId && japanShugiinListOrder == null) ||
          (japanDistrictId &&
            !JP_SHUGIIN_1994_CONSTITUENCIES.some(
              (district) => district.id === japanDistrictId && district.regionId === election.state
            ))
        ) {
          return NextResponse.json(
            { error: "Choose a valid 1994 Shugiin constituency or party-list nomination." },
            { status: 400 }
          );
        }
        if (japanShugiinListOrder != null) {
          const partySequentialId = Number.parseInt(character.party ?? "", 10);
          const registeredParty =
            Number.isSafeInteger(partySequentialId) && partySequentialId > 0
              ? await db.collection<PoliticalParty>("politicalParties").findOne({
                  countryId: "JP",
                  sequentialId: partySequentialId,
                })
              : null;
          if (!registeredParty || registeredParty.regimeStatus === "banned") {
            return NextResponse.json(
              {
                error:
                  "Join a registered, unbanned Japanese party before filing a Shugiin list nomination.",
              },
              { status: 403 }
            );
          }
        }
        try {
          await ensureJapanShugiinFilingIndexes(db);
        } catch {
          logRequest("POST", path, 503, Date.now() - start);
          return NextResponse.json(
            { error: "Japanese Shugiin filing guards are unavailable; try again later." },
            { status: 503 }
          );
        }
        if (japanDistrictId && character.party !== "independent") {
          const occupied = await db.collection<ElectionCandidate>("electionCandidates").findOne({
            electionId: electionObjectId,
            party: character.party,
            constituencyId: japanDistrictId,
            status: "active",
          });
          if (occupied)
            return NextResponse.json(
              { error: "Your party already has a nominee in this Shugiin constituency." },
              { status: 409 }
            );
        }
        if (japanShugiinListOrder != null) {
          const occupied = await db.collection<ElectionCandidate>("electionCandidates").findOne({
            electionId: electionObjectId,
            party: character.party,
            japanShugiinListOrder,
            status: "active",
          });
          if (occupied)
            return NextResponse.json(
              { error: "Your party already has a nominee at this Shugiin list rank." },
              { status: 409 }
            );
        }
      }
      if (hu2014 && (!huDistrictId || !isHuDistrictInRegion(huDistrictId, election.state))) {
        return NextResponse.json(
          { error: "Choose a valid Hungarian constituency in this region." },
          { status: 400 }
        );
      }
    }
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
    const councilFiling = election.russianCouncilRound
      ? await validateRussianCouncilPlayerFiling({
          db,
          election,
          character,
          turn: currentTurn,
          registrationOrder: now.getTime(),
        })
      : null;
    if (councilFiling && !councilFiling.allowed) {
      logRequest("POST", path, 403, Date.now() - start);
      return NextResponse.json(
        { error: councilFilingErrors[councilFiling.reason] },
        { status: 403 }
      );
    }
    const dumaFiling = election.russianDumaRound
      ? await validateRussianDumaPlayerFiling({
          db,
          election,
          character,
          turn: currentTurn,
          registrationOrder: now.getTime(),
        })
      : null;
    if (dumaFiling && !dumaFiling.allowed) {
      const errors = {
        "incompatible-office": "Your current office is incompatible with an ordinary Duma mandate.",
        "council-mandate":
          "You already hold a seated or certified Council mandate and cannot contest a Duma ballot.",
        "constituency-mandate":
          "You already hold a certified Duma constituency mandate and cannot contest another constituency.",
        "unbound-mandate":
          "This Duma election no longer matches its ratified constitutional mandate.",
        "invalid-ballot": "This Duma ballot has an invalid district or filing schedule.",
        "filing-closed": "The Duma candidate filing period has ended.",
        "invalid-residence":
          "You must live in an eligible Russian region to contest this Duma ballot.",
        "independent-list":
          "Independent candidates may contest a Duma constituency, but cannot join the national party list.",
        "unregistered-list":
          "Join an existing unbanned Russian party before contesting the national list.",
      };
      logRequest("POST", path, 403, Date.now() - start);
      return NextResponse.json({ error: errors[dumaFiling.reason] }, { status: 403 });
    }
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
    if (
      !isNationwideExecutive &&
      !(dumaFiling?.allowed && dumaFiling.nationalList) &&
      election.state &&
      character.homeState !== election.state
    ) {
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

    // A sitting Commons MP already holds a seat that is not on the ballot in a
    // by-election (#860): the race fills only vacated seats, and seating a
    // holder would double-seat them (additive resolution never sweeps).
    // Resign the seat first, then stand as a challenger.
    if (
      election.electionType === "special_commons" &&
      heldOffice?.type === "commons" &&
      "state" in heldOffice &&
      heldOffice.state === election.state
    ) {
      logRequest("POST", path, 403, Date.now() - start);
      return NextResponse.json(
        {
          error:
            "You already hold a Commons seat in this region, which is not on the ballot in a by-election. Resign your seat first to stand as a challenger.",
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

    if (
      (hu1991 || bgFounding) &&
      existingCandidate?.party !== undefined &&
      existingCandidate.party !== character.party
    )
      return NextResponse.json(
        { error: (bgFounding ? bgFoundingFilingMessages : hu1991FilingMessages)["party-changed"] },
        { status: 403 }
      );
    if (existingCandidate) {
      // If they have an active candidacy under a different party, withdraw it first
      if (existingCandidate.party !== character.party && !councilFiling) {
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
        // The candidate is still in the race under the new party: carry the
        // campaign across with its funds/levels instead of leaving it filed
        // under the old party (ticket #1313).
        await db.collection("campaigns").updateOne(
          {
            electionId: electionObjectId,
            candidateId: character._id,
            status: { $ne: "archived" },
          },
          { $set: { party: character.party, updatedAt: new Date() } }
        );
      } else if (existingCandidate.party === character.party) {
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
      ...(dumaFiling?.allowed ? { russianDumaNomination: dumaFiling.nomination } : {}),
      ...(councilFiling?.allowed ? { russianCouncilNomination: councilFiling.nomination } : {}),
      ...(hu2014 && huDistrictId ? { constituencyId: huDistrictId } : {}),
      ...(japanDistrictId ? { constituencyId: japanDistrictId } : {}),
      ...(japanShugiinListOrder != null ? { japanShugiinListOrder } : {}),
      ...(japanMixed && japanDistrictId && character.party !== "independent"
        ? {
            japanShugiinDistrictPartyKey: japanShugiinDistrictPartyKey(
              character.party,
              japanDistrictId
            ),
          }
        : {}),
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
      if (councilFiling) {
        const filed = await registerRussianCouncilPlayerCandidate({
          db,
          electionId: electionObjectId,
          candidate: candidateDoc,
          turn: currentTurn,
          now,
        });
        if (!filed.allowed) {
          logRequest("POST", path, 403, Date.now() - start);
          return NextResponse.json({ error: councilFilingErrors[filed.reason] }, { status: 403 });
        }
        result = { insertedId: filed.insertedId };
      } else if (bgFounding) {
        const filed = await registerBgFoundingPlayerFiling({
          db,
          electionId: electionObjectId,
          candidate: candidateDoc,
          requestedDistrictId: huDistrictId,
          turn: currentTurn,
          now,
        });
        if (!filed.allowed)
          return NextResponse.json(
            { error: bgFoundingFilingMessages[filed.reason] },
            { status: 403 }
          );
        result = { insertedId: filed.insertedId };
      } else if (hu1991) {
        const filed = await registerHu1991PlayerFiling({
          db,
          electionId: electionObjectId,
          candidate: candidateDoc,
          requestedDistrictId: huDistrictId,
          turn: currentTurn,
          now,
        });
        if (!filed.allowed)
          return NextResponse.json(
            {
              error:
                election.hungarianModernByElection && filed.reason === "filing-closed"
                  ? "Filing has closed for this constituency by-election."
                  : hu1991FilingMessages[filed.reason],
            },
            { status: 403 }
          );
        result = { insertedId: filed.insertedId };
      } else if (hu2014) {
        const existingNominee = await db
          .collection<ElectionCandidate>("electionCandidates")
          .findOne({
            electionId: electionObjectId,
            countryId: "HU",
            party: character.party,
            constituencyId: huDistrictId,
            status: "active",
          });
        if (existingNominee) {
          logRequest("POST", path, 409, Date.now() - start);
          return NextResponse.json(
            { error: "Your party already has a candidate in this constituency." },
            { status: 409 }
          );
        }
        result = await db.collection("electionCandidates").insertOne(candidateDoc);
      } else {
        result = await db.collection("electionCandidates").insertOne(candidateDoc);
      }
    } catch (error) {
      if (isActiveJapanShugiinNominationDuplicateKey(error)) {
        logRequest("POST", path, 409, Date.now() - start);
        return NextResponse.json(
          { error: "Your party already has a candidate in that Shugiin ballot position." },
          { status: 409 }
        );
      }
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
      electionType: election.electionType,
      phase: "primary",
    });
  } catch (error) {
    logRequest("POST", path, 500, Date.now() - start);
    return handleRouteError(error);
  }
}
