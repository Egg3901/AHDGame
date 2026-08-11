import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { adminPartyOrgPatchSchema } from "@/lib/api/schemas/admin";
import type { StatePartyOrg, State, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { validateOrganization } from "@/lib/utils/partyOrg";

// GET - Fetch party org for a state or all states
// Returns organization data for ALL parties, defaulting to 0 for parties without records
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const stateId = searchParams.get("state");

    const db = await getDb();

    // Fetch all parties for reference
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({})
      .sort({ isDefault: -1, memberCount: -1, name: 1 })
      .toArray();

    if (stateId) {
      // Fetch for specific state - include all parties with virtual records for missing ones
      const upperStateId = stateId.toUpperCase();
      // Admin tool is US-only (driven by US_STATES selector in the UI). Scope
      // the lookup to US to avoid cross-country state-ID collisions.
      const countryId = (searchParams.get("country") ?? "US").toUpperCase() as CountryId;

      // Get the state for political lean
      const state = await db.collection<State>("states").findOne({ _id: upperStateId, countryId });
      if (!state) {
        return NextResponse.json({ error: "State not found" }, { status: 404 });
      }

      // Get existing party org records
      const existingPartyOrg = await db
        .collection<StatePartyOrg>("statePartyOrg")
        .find({ stateId: upperStateId, countryId })
        .toArray();

      const orgMap = new Map(existingPartyOrg.map((po) => [po.partyId, po]));

      // Build complete list with virtual records for missing parties
      const now = new Date();
      const partyOrg = parties.map((party) => {
        const partySeqId = String(party.sequentialId);
        const existing = orgMap.get(partySeqId);
        if (existing) return existing;
        // Virtual record for party without org entry
        return {
          _id: `${upperStateId}_${partySeqId}`,
          stateId: upperStateId,
          partyId: partySeqId,
          organization: 0,
          createdAt: now,
          updatedAt: now,
        } as StatePartyOrg;
      });

      return NextResponse.json({
        partyOrg,
        parties,
      });
    } else {
      // Fetch all existing records
      const partyOrg = await db
        .collection<StatePartyOrg>("statePartyOrg")
        .find({})
        .sort({ stateId: 1, partyId: 1 })
        .toArray();

      return NextResponse.json({
        partyOrg,
        parties,
      });
    }
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH - Update party org for a specific state/party
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const parsed = await parseJsonBody(request, adminPartyOrgPatchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { stateId, countryId, partyId, organization } = parsed.data;

    const db = await getDb();

    // Validate state exists (scope by countryId to avoid cross-country ID collisions).
    const state = await db.collection<State>("states").findOne({
      _id: stateId.toUpperCase(),
      countryId: countryId.toUpperCase() as CountryId,
    });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    // Validate party exists — scope by the state's country so a partyId that
    // collides across countries resolves to the right party.
    const party = await db.collection<PoliticalParty>("politicalParties").findOne({
      sequentialId: Number(partyId),
      countryId: state.countryId,
    });
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    // Validate values
    if (organization !== undefined && !validateOrganization(organization)) {
      return NextResponse.json(
        { error: "Organization must be between 0 and 100" },
        { status: 400 }
      );
    }

    // Build update object
    const now = new Date();
    const updateData: Partial<StatePartyOrg> = {
      updatedAt: now,
    };

    if (organization !== undefined) {
      updateData.organization = organization;
    }

    const compoundId = `${stateId.toUpperCase()}_${partyId}`;

    // Update or insert
    await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
      { _id: compoundId },
      {
        $set: updateData,
        $setOnInsert: {
          _id: compoundId,
          countryId: state.countryId,
          stateId: stateId.toUpperCase(),
          partyId,
          organization: organization ?? 0,
          chairId: null,
          viceChairId: null,
          treasurerId: null,
          treasury: 0,
          stateTaxRate: 0,
          politicalStrength: 0,
          hasPresence: false,
          createdAt: now,
        },
      },
      { upsert: true }
    );

    // Log the update
    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "party_org_updated",
      username: "SYSTEM",
      adminUsername: admin.username,
      details: `Party org updated for ${party.name} in ${state.name} (Org: ${organization ?? "unchanged"})`,
      createdAt: now,
    });

    return NextResponse.json({
      success: true,
      message: `Party organization updated for ${party.name} in ${state.name}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
