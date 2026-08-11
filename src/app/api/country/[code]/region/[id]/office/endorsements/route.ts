import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireHumanSessionWithCharacter, requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import {
  COUNTRY_CONFIGS,
  getEndorseableElectionTypes,
  type CountryId,
} from "@/lib/constants/countries";
import { getOfficeHolderRow } from "@/lib/governorOffice/queries";
import { createEndorsement } from "@/lib/governorOffice/endorsements/createEndorsement";
import type { GovernorEndorsement, Election, ElectionCandidate } from "@/lib/db/types";

// POST /api/country/[code]/region/[id]/office/endorsements — Endorse a candidate.
// Auth: requireHumanSessionWithCharacter; must be the office-holder.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();
    const holder = await getOfficeHolderRow(db, countryId, stateId, auth.user.character._id);
    if (!holder) return NextResponse.json({ error: "Not the office-holder" }, { status: 403 });

    const parsed = await parseJsonBody(
      request,
      z.object({
        electionId: z.string().refine((v) => ObjectId.isValid(v), "Invalid electionId"),
        candidateId: z.string().refine((v) => ObjectId.isValid(v), "Invalid candidateId"),
      })
    );
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const result = await createEndorsement(db, {
      countryId,
      stateId,
      character: auth.user.character,
      electionId: new ObjectId(parsed.data.electionId),
      candidateId: new ObjectId(parsed.data.candidateId),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/country/[code]/region/[id]/office/endorsements — active + available races.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();
    const characterId = auth.user.character?._id;

    // Endorseable types come from the same allowlist as `createEndorsement`
    // so the GET payload matches what the POST will accept. Includes federal
    // chambers (US House/Senate, UK Commons, etc.) and presidential where
    // applicable, in addition to sub-national/state chambers.
    const allowedTypes = getEndorseableElectionTypes(countryId);
    // Presidential rows live with `state` set to the country code, not the
    // governor's state, so fetch them separately and merge — matches the SSR
    // path in office/page.tsx.
    const [scopedElections, presidentialElection] = await Promise.all([
      db
        .collection<Election>("elections")
        .find({ state: stateId, countryId, status: "active", electionType: { $in: allowedTypes } })
        .toArray(),
      allowedTypes.includes("president")
        ? db
            .collection<Election>("elections")
            .findOne({ electionType: "president", countryId, status: "active" })
        : Promise.resolve(null),
    ]);
    const elections: Election[] = presidentialElection
      ? [...scopedElections, presidentialElection]
      : scopedElections;

    const active = characterId
      ? await db
          .collection<GovernorEndorsement>("governorEndorsements")
          .find({
            countryId,
            stateId,
            endorsedByCharacterId: characterId,
            isActive: true,
          })
          .toArray()
      : [];

    const candidatesByElection: Record<string, ElectionCandidate[]> = {};
    for (const e of elections) {
      candidatesByElection[e._id.toString()] = await db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: e._id, status: "active" })
        .toArray();
    }

    return NextResponse.json({ elections, candidatesByElection, active });
  } catch (error) {
    return handleRouteError(error);
  }
}
