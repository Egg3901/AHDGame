/**
 * GET  /api/congress/bills?chamber=house|senate|joint&status=...&page=1
 * POST /api/congress/bills  — propose a new bill (immediately opens voting)
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getAuthUser } from "@/lib/auth";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse, statusResponse } from "@/lib/api/errors";
import { checkRateLimit, CONGRESS_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { logRequest } from "@/lib/api/requestLog";
import { proposeBillSchema } from "@/lib/api/schemas/congress";
import { buildBillDisplays } from "./billDisplays";
import { nationalBillListTallies } from "@/lib/legislature/queries/nationalBillQueries";
import type { ScopedVoteOfficial } from "@/lib/congress/billVoting";
import {
  buildChamberSeatMap,
  buildOverrideDisplay,
  type OverrideChamberDisplay,
} from "@/lib/congress/vetoOverrideTally";
import { NATIONAL_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import { canonicalizeLegislationTypeId } from "@/lib/legislationTypeAliases";
import type { Bill, Character, ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import type { BillDisplay, BillsResponse } from "@/lib/legislature/dto/billDisplay";
import { mayRuleByDecree } from "@/lib/singleplayerHeadOfState";
import { getBillProposalAutoFailWarning } from "@/lib/legislature/billAutoFailWarning";
import { loadBillLegislationTypes } from "@/lib/legislature/queries/loadBillLegislationTypes";
import { proposeNationalBill } from "@/lib/legislature/commands/proposeNationalBill";
export type { BillDisplay, BillsResponse } from "@/lib/legislature/dto/billDisplay";

// GET /api/congress/bills — Returns a paginated list of bills, optionally filtered by chamber and status.
// Auth: public
// Errors: 400
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const chamber = searchParams.get("chamber") ?? undefined;
    const viewedChamber = chamber === "house" || chamber === "senate" ? chamber : undefined;
    const statusFilter = searchParams.get("status") ?? undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = 50;
    const skip = (page - 1) * limit;

    const db = await getDb();
    const authUser = await getAuthUser().catch(() => null);

    // This endpoint serves the US Congress only — POST always writes
    // countryId "US". Scope the read to "US" unconditionally so bills from
    // other enabled countries whose chambers share the US names (e.g.
    // Nigeria's "senate") never leak into the US legislature view.
    const query: Record<string, unknown> = { countryId: "US" };
    if (chamber) {
      // Chamber tabs should follow where the bill is currently being worked,
      // not where it originated, so passed House bills move to the Senate tab.
      if (chamber === "joint") query.originChamber = "joint";
      // A concurrent bill is on the floor in BOTH chambers, and `currentChamber`
      // names only the lower one — so the Senate tab would not list the bill the
      // Senate is currently being asked to vote on.
      else
        query.$or = [
          { currentChamber: chamber },
          { status: { $in: ["active_both", "veto_override"] } },
        ];
    }
    if (statusFilter && statusFilter !== "all") query.status = statusFilter;

    const [bills, parties, total] = await Promise.all([
      db
        .collection<Bill>("bills")
        .aggregate<Bill>([
          { $match: query },
          {
            $addFields: {
              // A veto opens a new live ballot. Put that phase at the top of
              // both chamber lists without rewriting the bill's introduction date.
              __overridePriority: {
                $cond: [{ $eq: ["$status", "veto_override"] }, 1, 0],
              },
              __phaseStartedAt: {
                $cond: [
                  { $eq: ["$status", "veto_override"] },
                  { $ifNull: ["$overrideVotingStartedAt", "$updatedAt"] },
                  "$proposedAt",
                ],
              },
            },
          },
          { $sort: { __overridePriority: -1, __phaseStartedAt: -1, proposedAt: -1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: { fullText: 0, __overridePriority: 0, __phaseStartedAt: 0 } },
        ])
        .toArray(),
      // Congress bills are US-only - filter parties by countryId to avoid cross-country collisions
      db.collection<PoliticalParty>("politicalParties").find({ countryId: "US" }).toArray(),
      db.collection<Bill>("bills").countDocuments(query),
    ]);

    const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));
    const legislationTypeMap = await loadBillLegislationTypes(db, bills);

    const chamberOfficials: ScopedVoteOfficial[] = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        {
          countryId: "US",
          officeType: { $in: ["house", "senate"] },
        },
        {
          projection: {
            characterId: 1,
            countryId: 1,
            nppId: 1,
            officeType: 1,
            seatsHeld: 1,
          },
        }
      )
      .toArray();
    const overrideSeatMap = buildChamberSeatMap(chamberOfficials);
    const overrideDisplayByBill = new Map<string, OverrideChamberDisplay>();
    for (const bill of bills) {
      const { origin, other } = nationalBillListTallies(
        bill,
        chamberOfficials,
        "US",
        "house",
        "senate"
      );
      bill.votesFor = origin.for;
      bill.votesAgainst = origin.against;
      bill.votesAbstain = origin.abstain;
      bill.otherChamberVotesFor = other.for;
      bill.otherChamberVotesAgainst = other.against;
      bill.otherChamberVotesAbstain = other.abstain;
      if (bill.status === "veto_override") {
        overrideDisplayByBill.set(
          bill._id.toString(),
          buildOverrideDisplay(bill.vetoOverrideVotes, overrideSeatMap)
        );
      }
    }

    // Use shared terminal statuses constant
    const TERMINAL_STATUSES = NATIONAL_TERMINAL_STATUSES;

    let myCharacterId: string | null = null;
    let myPolicies: Character["policies"] | null = null;
    let canPropose = false;
    let inCongress = false;
    let myChamber: "house" | "senate" | null = null;
    let hasActiveBill = false;
    if (authUser) {
      const char = await getCharacterByUserId(db, authUser.userId);
      myCharacterId = char?._id?.toString() ?? null;
      myPolicies = char?.policies ?? null;
      if (myCharacterId) {
        const [official, activeBill] = await Promise.all([
          db.collection<ElectedOfficial>("electedOfficials").findOne({
            characterId: new ObjectId(myCharacterId),
            // Legacy national officials predate countryId and are US rows.
            $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
            officeType: { $in: ["house", "senate"] },
          }),
          db.collection<Bill>("bills").findOne({
            sponsorId: new ObjectId(myCharacterId),
            status: { $nin: TERMINAL_STATUSES },
          }),
        ]);
        const sovereign = char ? mayRuleByDecree(char, "US") : false;
        inCongress = !!official;
        hasActiveBill = !!activeBill;
        // Congress members can propose only when they have no active bill in flight
        canPropose = (inCongress || sovereign) && (!hasActiveBill || sovereign);
        myChamber = sovereign ? "house" : (official?.officeType as "house" | "senate" | null);
      }
      if (authUser.isAdmin) canPropose = true;
    }
    const adminOverride = !!(authUser?.isAdmin && !inCongress);

    // Collect blocked provisions from all active US Congress bills
    const activeBillsForProvisions = await db
      .collection<Bill>("bills")
      .find(
        { countryId: "US", status: { $nin: TERMINAL_STATUSES } },
        { projection: { provisions: 1 } }
      )
      .toArray();
    const blockedProvisions: { legislationTypeId: string; policyOptionId: string }[] = [];
    for (const b of activeBillsForProvisions) {
      if (!b.provisions) continue;
      for (const p of b.provisions) {
        if (!isPolicyProvision(p)) continue;
        if (p.legislationTypeId && p.policyOptionId) {
          blockedProvisions.push({
            legislationTypeId:
              canonicalizeLegislationTypeId(p.legislationTypeId) ?? p.legislationTypeId,
            policyOptionId: p.policyOptionId,
          });
        }
      }
    }

    // Votes stay on the list query so The Count can live-scope (ticket #1075).
    const myVoteMap = new Map<string, { origin: string | null; other: string | null }>();
    if (myCharacterId) {
      for (const b of bills) {
        myVoteMap.set(b._id.toString(), {
          origin: b.votes?.[myCharacterId] ?? null,
          other: b.otherChamberVotes?.[myCharacterId] ?? null,
        });
      }
    }

    const proposalWarningsEntries = await Promise.all(
      (["house", "senate", "joint"] as const).map(async (originChamber) => [
        originChamber,
        await getBillProposalAutoFailWarning(db, "US", originChamber),
      ])
    );
    const proposalWarnings = Object.fromEntries(proposalWarningsEntries);

    const billDisplays: BillDisplay[] = buildBillDisplays(bills, {
      partyMap,
      legislationTypeMap,
      myVoteMap,
      myCharacterId,
      myChamber,
      viewedChamber,
      overrideDisplayByBill,
      myPolicies,
    });

    return NextResponse.json({
      bills: billDisplays,
      total,
      canPropose,
      adminOverride,
      myChamber,
      hasActiveBill,
      blockedProvisions,
      proposalWarnings,
    } satisfies BillsResponse);
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/congress/bills — Proposes a new bill through the shared national command.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 429
export async function POST(request: Request) {
  const start = Date.now();
  const path = new URL(request.url).pathname;
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) {
      logRequest("POST", path, 401, Date.now() - start);
      return auth.response;
    }

    const limit = checkRateLimit(
      `congress:${auth.user.userId}`,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!limit.ok) {
      logRequest("POST", path, 429, Date.now() - start);
      return rateLimitResponse(limit.retryAfter);
    }

    const parsed = await parseJsonBody(request, proposeBillSchema);
    if (!parsed.success) {
      logRequest("POST", path, parsed.status, Date.now() - start);
      return errorResponse(parsed.status, parsed.error);
    }
    if (!["house", "senate", "joint"].includes(parsed.data.chamber)) {
      logRequest("POST", path, 400, Date.now() - start);
      return errorResponse(
        400,
        "Invalid chamber for US Congress. Use /api/country/[code]/legislature/bills for non-US legislatures."
      );
    }

    const db = await getDb();
    const result = await proposeNationalBill(db, "US", auth.user, parsed.data);
    logRequest("POST", path, result.status, Date.now() - start);

    if (result.status === 201 && typeof result.body.billId === "string") {
      return NextResponse.json(
        {
          id: result.body.billId,
          message:
            typeof result.body.message === "string"
              ? result.body.message
              : "Bill proposed; voting is now open.",
          ...(result.body.enacted === true ? { enacted: true } : {}),
        },
        { status: 201 }
      );
    }
    return statusResponse(result.status, result.body);
  } catch (error) {
    logRequest("POST", path, 500, Date.now() - start);
    return handleRouteError(error);
  }
}
