import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { NPP, ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Policy signature to party slug mapping.
 * These match the values from generateDefaultPolicies in seedHistorical.ts.
 * System-generated NPPs have these exact policy combinations.
 */
const POLICY_TO_PARTY: Record<string, Record<string, string>> = {
  US: {
    "-2,-2": "democrat",
    "2,2": "republican",
    "0,0": "independent",
  },
  UK: {
    "-2,-2": "uk_labour",
    "2,1": "uk_conservative",
    "0,-1": "uk_libdem",
    "-1,-2": "uk_snp",
    "-1,-1": "uk_plaid", // Also uk_sdlp - will need additional context
    "-2,-3": "uk_green",
    "1,3": "uk_dup",
    "-2,-1": "uk_sf",
    "0,0": "uk_independent",
  },
};

// Party slug to display name for logging. Includes UK preset-gated
// defaults (Reform UK 2019-only, UUP 1991-only) plus the full JP and DE
// rosters so admin diagnostic output renders human names instead of
// raw slugs for every default a 1991 or 2019 game can produce.
const SLUG_TO_NAME: Record<string, string> = {
  democrat: "Democratic",
  republican: "Republican",
  // UK
  uk_labour: "Labour",
  uk_conservative: "Conservative",
  uk_libdem: "Liberal Democrats",
  uk_snp: "Scottish National Party",
  uk_plaid: "Plaid Cymru",
  uk_green: "Green Party",
  uk_reform: "Reform UK",
  uk_dup: "Democratic Unionist Party",
  uk_sf: "Sinn Féin",
  uk_sdlp: "Social Democratic and Labour Party",
  uk_alliance: "Alliance Party",
  uk_uup: "Ulster Unionist Party",
  // JP
  jp_ldp: "Liberal Democratic Party",
  jp_cdp: "Constitutional Democratic Party",
  jp_komeito: "Komeito",
  jp_jcp: "Japanese Communist Party",
  jp_ishin: "Nippon Ishin no Kai",
  jp_dpfp: "Democratic Party for the People",
  jp_jsp: "Japan Socialist Party",
  jp_dsp: "Democratic Socialist Party",
  // DE
  de_spd: "Sozialdemokratische Partei Deutschlands",
  de_cdu: "Christlich Demokratische Union",
  de_csu: "Christlich-Soziale Union in Bayern",
  de_greens: "Bündnis 90/Die Grünen",
  de_fdp: "Freie Demokratische Partei",
  de_linke: "Die Linke",
  de_afd: "Alternative für Deutschland",
  de_pds: "Partei des Demokratischen Sozialismus",
};

interface DiagnosticNpp {
  _id: string;
  name: string;
  countryId: string;
  homeState: string;
  currentOffice: string | null;
  policies: { economic: number; social: number };
  inferredParty: string | null;
  inferredPartyName: string | null;
}

interface DiagnosticResult {
  status: string;
  message: string;
  droppedNpps: DiagnosticNpp[];
  totalAffected: number;
}

/**
 * GET /api/admin/heal/dropped-npp-parties
 *
 * Diagnoses NPPs that are currently independent but whose policy positions
 * indicate they should belong to a party (i.e., they were system-generated
 * and incorrectly became independents).
 *
 * Identification method: NPPs with policy signatures matching known party
 * defaults (e.g., -2,-2 for Democrat/Labour) are assumed to be system-generated.
 * Player-created NPPs would not have these exact policy combinations.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Find ALL independent NPPs that are not retired
    // We don't require generatedAt since older NPPs may not have this field
    const independentNpps = await db
      .collection<NPP>("npps")
      .find({
        party: "independent",
        retiredAt: null,
      })
      .toArray();

    const droppedNpps: DiagnosticNpp[] = [];

    for (const npp of independentNpps) {
      const countryId = npp.countryId as CountryId;
      const policyKey = `${npp.policies.economic},${npp.policies.social}`;
      const countryPolicies = POLICY_TO_PARTY[countryId];

      // Skip if policies match independent (0,0)
      if (policyKey === "0,0") continue;

      const inferredSlug = countryPolicies?.[policyKey] ?? null;
      const inferredPartyName = inferredSlug ? (SLUG_TO_NAME[inferredSlug] ?? inferredSlug) : null;

      // Only include if we can infer a non-independent party
      if (inferredSlug && inferredSlug !== "independent" && inferredSlug !== "uk_independent") {
        droppedNpps.push({
          _id: npp._id.toString(),
          name: npp.name,
          countryId,
          homeState: npp.homeState,
          currentOffice: npp.currentOffice?.type ?? null,
          policies: npp.policies,
          inferredParty: inferredSlug,
          inferredPartyName,
        });
      }
    }

    const status = droppedNpps.length === 0 ? "ok" : "issues_found";
    const message =
      droppedNpps.length === 0
        ? "No NPPs with dropped parties found. All system-generated NPPs have correct party assignments."
        : `Found ${droppedNpps.length} NPP(s) whose parties can be restored based on policy positions.`;

    return NextResponse.json({
      status,
      message,
      droppedNpps: droppedNpps.slice(0, 100), // Limit for UI
      totalAffected: droppedNpps.length,
    } satisfies DiagnosticResult);
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/dropped-npp-parties
 *
 * Heals NPPs by:
 * 1. Restoring their party based on policy signature
 * 2. Updating corresponding electedOfficials records
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    // Find ALL independent NPPs (not just ones with generatedAt)
    const independentNpps = await db
      .collection<NPP>("npps")
      .find({
        party: "independent",
        retiredAt: null,
      })
      .toArray();

    // Build party slug -> sequentialId map
    const parties = await db.collection<PoliticalParty>("politicalParties").find({}).toArray();
    const partySlugToId = new Map<string, string>();
    for (const p of parties) {
      const slug = Object.entries(SLUG_TO_NAME).find(([, name]) => name === p.name)?.[0];
      if (slug) {
        partySlugToId.set(`${p.countryId}:${slug}`, String(p.sequentialId));
      }
    }

    const results = {
      nppsRestored: 0,
      officialsUpdated: 0,
      partyCounts: {} as Record<string, number>,
    };

    for (const npp of independentNpps) {
      const countryId = npp.countryId as CountryId;
      const policyKey = `${npp.policies.economic},${npp.policies.social}`;
      const countryPolicies = POLICY_TO_PARTY[countryId];

      // Skip if policies match independent
      if (policyKey === "0,0") continue;

      const inferredSlug = countryPolicies?.[policyKey];
      if (!inferredSlug || inferredSlug === "independent" || inferredSlug === "uk_independent") {
        continue;
      }

      // Get the sequentialId for this party
      const partyId = partySlugToId.get(`${countryId}:${inferredSlug}`);
      if (!partyId) {
        console.warn(
          `[heal/dropped-npp-parties] Could not find party ID for ${inferredSlug} in ${countryId}`
        );
        continue;
      }

      // Update NPP party
      await db.collection<NPP>("npps").updateOne(
        { _id: npp._id },
        {
          $set: {
            party: partyId,
            updatedAt: now,
          },
        }
      );
      results.nppsRestored++;

      const partyName = SLUG_TO_NAME[inferredSlug] ?? inferredSlug;
      results.partyCounts[partyName] = (results.partyCounts[partyName] ?? 0) + 1;

      // Update corresponding electedOfficials records
      const officialResult = await db.collection<ElectedOfficial>("electedOfficials").updateMany(
        { nppId: npp._id },
        {
          $set: {
            party: partyId,
            updatedAt: now,
          },
        }
      );
      results.officialsUpdated += officialResult.modifiedCount;
    }

    const partyBreakdown = Object.entries(results.partyCounts)
      .map(([party, count]) => `${count} ${party}`)
      .join(", ");

    return NextResponse.json({
      success: true,
      message:
        results.nppsRestored === 0
          ? "No NPPs needed party restoration."
          : `Restored parties for ${results.nppsRestored} NPP(s) (${partyBreakdown}). Updated ${results.officialsUpdated} elected official record(s).`,
      results,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
