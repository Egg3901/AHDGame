import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { requireHumanSessionWithCharacter, requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import {
  COUNTRY_CONFIGS,
  getExecutiveEndorseableElectionTypes,
  type CountryId,
} from "@/lib/constants/countries";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { getGameTime } from "@/lib/time/gameTime";
import { isPrimaryEnded } from "@/lib/elections/phases";
import { createExecutiveEndorsement } from "@/lib/governorOffice/endorsements/createExecutiveEndorsement";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import { GOVERNOR_ENDORSEMENT_ACTION_COST } from "@/lib/constants/governorOffice";
import type {
  Character,
  Election,
  ElectionCandidate,
  ExecutiveEndorsement,
  GovernorOfficeState,
  PoliticalParty,
  State,
} from "@/lib/db/types";
import { buildPartyIdResolver } from "@/lib/parties/partyMatch";

// Re-uses electionLabels via the constants/countries re-export.
// Import resolved inline above to keep this file self-contained.

// POST /api/country/[code]/executive/endorsements — sitting leader endorses
// a sub-presidential candidate. Auth: requireHumanSessionWithCharacter; must
// be the seated head of government.
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const leader = await isSittingLeader(db, countryId, auth.user.character._id);
    if (!leader) {
      return NextResponse.json(
        { error: "Only the sitting leader can endorse from this office" },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(
      request,
      z.object({
        electionId: z.string().min(1),
        candidateId: z.string().min(1),
      })
    );
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (!ObjectId.isValid(parsed.data.electionId) || !ObjectId.isValid(parsed.data.candidateId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const result = await createExecutiveEndorsement(db, {
      countryId,
      character: auth.user.character,
      electionId: new ObjectId(parsed.data.electionId),
      candidateId: new ObjectId(parsed.data.candidateId),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/country/[code]/executive/endorsements?state=AZ — page payload.
// Returns active endorsements (all states), the country's state list for the
// filter dropdown, available races in the selected state, and the leader's
// Office AP balance for the spend gate.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const characterId = auth.user.character?._id;
    if (!characterId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const db = await getDb();
    const leader = await isSittingLeader(db, countryId, characterId);
    const isAdmin = auth.user.isAdmin === true;
    if (!leader && !isAdmin) {
      return NextResponse.json({ error: "Not the sitting leader" }, { status: 403 });
    }

    const url = new URL(request.url);
    const selectedState = (url.searchParams.get("state") ?? "").toUpperCase();

    const allowedRaceTypes = getExecutiveEndorseableElectionTypes(countryId);
    const stateId = getNationalStateId(countryId);

    const [activeEndorsements, racesInSelectedState, states, officeState, myParty] =
      await Promise.all([
        db
          .collection<ExecutiveEndorsement>("executiveEndorsements")
          .find({ countryId, endorsedByCharacterId: characterId, isActive: true })
          .sort({ createdAt: -1 })
          .toArray(),
        selectedState
          ? db
              .collection<Election>("elections")
              .find({
                countryId,
                state: selectedState,
                status: "active",
                electionType: { $in: allowedRaceTypes },
              })
              .toArray()
          : Promise.resolve([]),
        db
          .collection<State>("states")
          .find({ countryId })
          .project<{ _id: string; name: string }>({ _id: 1, name: 1 })
          .sort({ name: 1 })
          .toArray(),
        db.collection<GovernorOfficeState>("governorOfficeState").findOne({ countryId, stateId }),
        db
          .collection<{ _id: ObjectId; party?: string }>("characters")
          .findOne({ _id: characterId }, { projection: { party: 1 } })
          .then((c) => c?.party ?? null),
      ]);

    const electionIds = racesInSelectedState.map((e) => e._id);
    const stateCandidates = electionIds.length
      ? await db
          .collection<ElectionCandidate>("electionCandidates")
          .find({ electionId: { $in: electionIds }, status: "active" })
          .toArray()
      : [];

    const resolvePartyId = await buildPartyIdResolver(db, countryId);
    const myCanonicalParty = resolvePartyId(myParty);

    const playerCharacterIds = [
      ...new Set(
        stateCandidates.filter((c) => !c.isNPP && c.characterId).map((c) => c.characterId!)
      ),
    ];
    const playerCharacters = playerCharacterIds.length
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: playerCharacterIds } })
          .project<{ _id: ObjectId; party?: string }>({ _id: 1, party: 1 })
          .toArray()
      : [];
    const currentPartyByCharacterId = new Map(
      playerCharacters.map((c) => [c._id.toString(), c.party ?? null])
    );

    const partyDocs = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId })
      .project<{ sequentialId: number; name: string; color: string; logoUrl?: string }>({
        sequentialId: 1,
        name: 1,
        color: 1,
        logoUrl: 1,
      })
      .toArray();
    const partyBySeq = new Map(partyDocs.map((p) => [String(p.sequentialId), p]));

    const myEndorsedCandidateIds = new Set(activeEndorsements.map((e) => e.candidateId.toString()));

    const priorityIndex = new Map(allowedRaceTypes.map((t, i) => [t, i] as const));
    const sortedElections = [...racesInSelectedState].sort((a, b) => {
      const ap = priorityIndex.get(a.electionType as string) ?? 99;
      const bp = priorityIndex.get(b.electionType as string) ?? 99;
      if (ap !== bp) return ap - bp;
      return (a.senateClass ?? 0) - (b.senateClass ?? 0);
    });

    // Use game-clock effective-now so the phase label matches turn-based resolution.
    const endorsementGameTime = await getGameTime();
    const availableRaces = sortedElections.map((e) => {
      const baseLabel = formatElectionTypeLabel(e.electionType as string, countryId);
      const suffix = [
        e.senateClass ? `Class ${e.senateClass}` : null,
        e.chamberClass ? `Chamber Class ${e.chamberClass}` : null,
        e.totalSeats && e.totalSeats > 1 ? `${e.totalSeats} seats` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const phase: "primary" | "general" = isPrimaryEnded(
        e,
        endorsementGameTime.currentTurn,
        endorsementGameTime
      )
        ? "general"
        : "primary";
      return {
        electionId: e._id.toString(),
        title: suffix ? `${baseLabel} · ${suffix}` : baseLabel,
        phase,
        candidates: stateCandidates
          .filter((c) => c.electionId.toString() === e._id.toString())
          .map((c) => {
            const effectiveParty =
              !c.isNPP && c.characterId
                ? (currentPartyByCharacterId.get(c.characterId.toString()) ?? c.party)
                : c.party;
            const canonicalParty = resolvePartyId(effectiveParty);
            const party = canonicalParty ? partyBySeq.get(canonicalParty) : undefined;
            return {
              id: c._id.toString(),
              name: c.characterName,
              party: effectiveParty,
              partyName: party?.name ?? null,
              partyColor: party?.color ?? null,
              partyLogoUrl: party?.logoUrl ?? null,
              isPartyMatch:
                myCanonicalParty != null &&
                canonicalParty != null &&
                myCanonicalParty === canonicalParty,
              alreadyEndorsedByMe: myEndorsedCandidateIds.has(c._id.toString()),
            };
          }),
      };
    });

    return NextResponse.json({
      countryId,
      viewerIsLeader: leader,
      viewerIsAdmin: isAdmin,
      myParty,
      gubernatorialActions: officeState?.gubernatorialActions ?? 0,
      actionCost: GOVERNOR_ENDORSEMENT_ACTION_COST,
      states: states.map((s) => ({ id: s._id, name: s.name })),
      selectedState: selectedState || null,
      activeEndorsements: activeEndorsements.map((e) => ({
        _id: e._id!.toString(),
        electionId: e.electionId.toString(),
        candidateId: e.candidateId.toString(),
        candidateName: e.candidateName,
        targetStateId: e.targetStateId,
      })),
      availableRaces,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
