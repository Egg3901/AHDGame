import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth, requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getAuthAdmin } from "@/lib/auth";
import { getGameState } from "@/lib/gameState";
import { isRedistrictingEnabled } from "@/lib/redistricting/flag";
import { canManageOffice } from "@/lib/governorOffice/access";
import { checkStateTrifecta } from "@/lib/redistricting/trifecta";
import { computeRedistrictCaps } from "@/lib/redistricting/caps";
import { effectiveRedistrictCaps } from "@/lib/redistricting/autoMap";
import { validateRedistrictMap } from "@/lib/redistricting/legality";
import type { CongressionalDistrict, DistrictSquares, RedistrictLedgerEntry } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

const BodySchema = z.object({
  districts: z
    .array(
      z.object({
        left: z.number().int().min(0).max(16),
        right: z.number().int().min(0).max(16),
        grey: z.number().int().min(0).max(16),
      })
    )
    .min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase();
    const stateId = id.toUpperCase();
    if (!(countryId in COUNTRY_CONFIGS)) {
      return NextResponse.json({ error: "Unknown country" }, { status: 400 });
    }

    const auth = await requireHumanSessionWithCharacter(req);
    if (!auth.ok) return auth.response;
    const character = auth.user.character;
    const admin = await getAuthAdmin();
    const isAdmin = !!admin;

    const db = await getDb();

    const gs = await getGameState();
    if (!isRedistrictingEnabled(gs)) {
      return NextResponse.json({ error: "Redistricting is not enabled" }, { status: 404 });
    }
    // US-only by construction: only US states have congressionalDistricts docs, so
    // non-US countries fall through to the "No districts to redraw" 404 below.

    const currentYear = gs?.currentYear;
    let trifectaPartyId = "";
    if (!isAdmin) {
      // Governor authorization.
      const canManage = await canManageOffice(db, countryId as CountryId, stateId, character._id);
      if (!canManage) {
        return NextResponse.json(
          { error: "Only the governor may redraw the map" },
          { status: 403 }
        );
      }

      // Census window: only in the census year, once per census.
      if (typeof gs?.lastCensusYear !== "number" || gs.lastCensusYear !== currentYear) {
        return NextResponse.json(
          { error: "Redistricting is only allowed in a census year" },
          { status: 403 }
        );
      }

      // Trifecta gate.
      const trifecta = await checkStateTrifecta(db, countryId, stateId);
      if (!trifecta.hasTrifecta) {
        return NextResponse.json(
          { error: "A redraw requires controlling the governorship and the state legislature" },
          { status: 403 }
        );
      }
      trifectaPartyId = trifecta.partyId ?? "";
    }

    // Load the live map.
    const docs = (await db
      .collection<CongressionalDistrict>("congressionalDistricts")
      .find({ countryId, stateId } as Partial<CongressionalDistrict>)
      .sort({ index: 1 })
      .toArray()) as CongressionalDistrict[];
    if (docs.length === 0) {
      return NextResponse.json({ error: "No districts to redraw" }, { status: 404 });
    }
    if (!isAdmin && docs.some((d) => d.lastRedrawnCensus === currentYear)) {
      return NextResponse.json(
        { error: "This map has already been redrawn this census" },
        { status: 403 }
      );
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid map" }, { status: 400 });
    const proposed = parsed.data.districts;
    if (proposed.length !== docs.length) {
      return NextResponse.json(
        { error: `Expected ${docs.length} districts, got ${proposed.length}` },
        { status: 400 }
      );
    }

    // Budget = the live map's conserved totals.
    const budget: DistrictSquares = docs.reduce(
      (acc, d) => ({
        left: acc.left + d.squares.left,
        right: acc.right + d.squares.right,
        grey: acc.grey + d.squares.grey,
      }),
      { left: 0, right: 0, grey: 0 }
    );

    const caps = effectiveRedistrictCaps(
      budget,
      await computeRedistrictCaps(db, countryId, stateId, docs.length)
    );
    const { legal, violations } = validateRedistrictMap(proposed, budget, caps);
    if (!legal) {
      return NextResponse.json({ error: "Illegal map", violations }, { status: 400 });
    }

    // Persist the redraw + ledger.
    const now = new Date();
    const before = docs.map((d) => d.squares);
    for (let i = 0; i < docs.length; i++) {
      const sq = proposed[i];
      await db.collection<CongressionalDistrict>("congressionalDistricts").updateOne(
        { _id: docs[i]._id },
        {
          $set: {
            squares: sq,
            netLean: sq.right - sq.left,
            greyShare: sq.grey / 16,
            source: "redraw",
            lastRedrawnCensus: currentYear,
            updatedAt: now,
          },
        }
      );
    }
    await db.collection<RedistrictLedgerEntry>("redistrictLedger").insertOne({
      _id: new ObjectId(),
      countryId: countryId as CountryId,
      stateId,
      censusYear: currentYear as number,
      actorCharacterId: character._id,
      actorParty: isAdmin ? "admin" : trifectaPartyId,
      before,
      after: proposed,
      lawSnapshot: {
        canDraw: caps.canDraw,
        maxDistrictDeviation: caps.maxDistrictDeviation,
        maxPackedDistricts: caps.maxPackedDistricts,
        efficiencyGapCeiling: caps.efficiencyGapCeiling,
      },
      createdAt: now,
    });

    return NextResponse.json({ ok: true, message: "Map redrawn" });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase();
    const stateId = id.toUpperCase();
    if (!(countryId in COUNTRY_CONFIGS)) {
      return NextResponse.json({ error: "Unknown country" }, { status: 400 });
    }

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const character = auth.user.character ?? null;
    const admin = await getAuthAdmin();
    const isAdmin = !!admin;

    const db = await getDb();
    const gs = await getGameState();

    const docs = (await db
      .collection<CongressionalDistrict>("congressionalDistricts")
      .find({ countryId, stateId } as Partial<CongressionalDistrict>)
      .sort({ index: 1 })
      .toArray()) as CongressionalDistrict[];

    const budget: DistrictSquares = docs.reduce(
      (acc, d) => ({
        left: acc.left + d.squares.left,
        right: acc.right + d.squares.right,
        grey: acc.grey + d.squares.grey,
      }),
      { left: 0, right: 0, grey: 0 }
    );
    const caps = effectiveRedistrictCaps(
      budget,
      await computeRedistrictCaps(db, countryId, stateId, docs.length || 1)
    );
    const districts = docs.map((d) => ({ index: d.index, squares: d.squares }));

    // Eligibility, with a human-readable reason for the first failing gate.
    let reason: string | null = null;
    const currentYear = gs?.currentYear;
    if (!isRedistrictingEnabled(gs)) reason = "Redistricting is not enabled.";
    else if (docs.length === 0) reason = "This state has no districts.";
    else if (isAdmin) {
      // Admins bypass governor, trifecta, census-year, and commission gates.
      if (!character) reason = "You need an active character to submit a redraw.";
    } else if (!character) reason = "You need an active character.";
    else if (!(await canManageOffice(db, countryId as CountryId, stateId, character._id)))
      reason = "Only the governor may redraw the map.";
    else if (typeof gs?.lastCensusYear !== "number" || gs.lastCensusYear !== currentYear)
      reason = "Redistricting is only allowed in a census year.";
    else if (docs.some((d) => d.lastRedrawnCensus === currentYear))
      reason = "This map has already been redrawn this census.";
    else if (!(await checkStateTrifecta(db, countryId, stateId)).hasTrifecta)
      reason = "A redraw requires controlling the governorship and the state legislature.";
    else if (!caps.canDraw)
      reason =
        "An independent or bipartisan commission draws this map; the legislature cannot redraw it.";

    return NextResponse.json({
      canRedraw: reason === null,
      reason,
      districts,
      budget,
      caps,
      isAdminOverride: isAdmin && reason === null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
