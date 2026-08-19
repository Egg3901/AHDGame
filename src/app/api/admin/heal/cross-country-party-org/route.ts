// GET diagnoses / POST deletes statePartyOrg records where the party belongs to a different country than the state.
// Auth: requireAdmin
// Errors: 403
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { StatePartyOrg, PoliticalParty, State } from "@/lib/db/types";

interface MismatchedRecord {
  _id: string;
  stateId: string;
  partyId: string;
  partyCountry: string;
  stateCountry: string;
  organization: number;
}

/**
 * GET /api/admin/heal/cross-country-party-org
 * Diagnose statePartyOrg records where party country doesn't match state country
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Get all parties and states to build lookup maps
    const [parties, states, allPartyOrg] = await Promise.all([
      db.collection<PoliticalParty>("politicalParties").find({}).toArray(),
      db.collection<State>("states").find({}).toArray(),
      db.collection<StatePartyOrg>("statePartyOrg").find({}).toArray(),
    ]);

    // Key by country:sequentialId since sequential IDs are per-country
    const partyByCountryAndSeqId = new Map(
      parties.map((p) => [`${p.countryId}:${p.sequentialId}`, p])
    );
    const stateCountryMap = new Map(states.map((s) => [s._id, s.countryId]));

    // Find mismatched records
    const mismatched: MismatchedRecord[] = [];
    for (const spo of allPartyOrg) {
      const stateCountry = stateCountryMap.get(spo.stateId);
      if (!stateCountry) continue;

      // Look up party in the state's country first
      const partyInStateCountry = partyByCountryAndSeqId.get(`${stateCountry}:${spo.partyId}`);

      // If party exists in state's country, it's correctly assigned
      if (partyInStateCountry) continue;

      // Check if party exists in a different country
      let partyCountry: string | null = null;
      for (const p of parties) {
        if (String(p.sequentialId) === spo.partyId) {
          partyCountry = p.countryId;
          break;
        }
      }

      // If party found in wrong country, or not found at all, it's mismatched
      if (partyCountry && partyCountry !== stateCountry) {
        mismatched.push({
          _id: spo._id,
          stateId: spo.stateId,
          partyId: spo.partyId,
          partyCountry,
          stateCountry,
          organization: spo.organization,
        });
      }
    }

    return NextResponse.json({
      status: mismatched.length === 0 ? "ok" : "needs_fix",
      issueCount: mismatched.length,
      records: mismatched.slice(0, 50), // Limit display to first 50
      message:
        mismatched.length === 0
          ? "No cross-country party organization records found"
          : `Found ${mismatched.length} party org record(s) in wrong country`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/cross-country-party-org
 * Delete statePartyOrg records where party country doesn't match state country
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Get all parties and states to build lookup maps
    const [parties, states, allPartyOrg] = await Promise.all([
      db.collection<PoliticalParty>("politicalParties").find({}).toArray(),
      db.collection<State>("states").find({}).toArray(),
      db.collection<StatePartyOrg>("statePartyOrg").find({}).toArray(),
    ]);

    // Key by country:sequentialId since sequential IDs are per-country
    const partyByCountryAndSeqId = new Map(
      parties.map((p) => [`${p.countryId}:${p.sequentialId}`, p])
    );
    const stateCountryMap = new Map(states.map((s) => [s._id, s.countryId]));

    // Find IDs to delete
    const idsToDelete: string[] = [];
    for (const spo of allPartyOrg) {
      const stateCountry = stateCountryMap.get(spo.stateId);
      if (!stateCountry) continue;

      // Look up party in the state's country first
      const partyInStateCountry = partyByCountryAndSeqId.get(`${stateCountry}:${spo.partyId}`);

      // If party exists in state's country, it's correctly assigned
      if (partyInStateCountry) continue;

      // Check if party exists in a different country
      let partyCountry: string | null = null;
      for (const p of parties) {
        if (String(p.sequentialId) === spo.partyId) {
          partyCountry = p.countryId;
          break;
        }
      }

      // If party found in wrong country, it's mismatched
      if (partyCountry && partyCountry !== stateCountry) {
        idsToDelete.push(spo._id);
      }
    }

    if (idsToDelete.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No cross-country party organization records to delete",
        deleted: 0,
      });
    }

    // Delete the mismatched records
    const result = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .deleteMany({ _id: { $in: idsToDelete } });

    return NextResponse.json({
      success: true,
      message: `Deleted ${result.deletedCount} cross-country party organization record(s)`,
      deleted: result.deletedCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
