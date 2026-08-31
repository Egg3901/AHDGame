/**
 * GET  /api/congress/bills?chamber=house|senate|joint&status=...&page=1
 * POST /api/congress/bills  — propose a new bill (immediately opens voting)
 */
import { validateElectoralLawProvision } from "@/lib/elections/electoralLaws";
import type { ElectoralLawProvision } from "@/lib/db/types/legislation";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, CONGRESS_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { logRequest } from "@/lib/api/requestLog";
import { proposeBillSchema } from "@/lib/api/schemas/congress";
import { buildBillDisplays } from "./billDisplays";
import { nationalBillListTallies } from "@/lib/legislature/queries/nationalBillQueries";
import type { ScopedVoteOfficial } from "@/lib/congress/billVoting";
import {
  checkDuplicateProvisions,
  checkDuplicateTariffProvisions,
  checkCurrentPolicyLevel,
  NATIONAL_TERMINAL_STATUSES,
} from "@/lib/congress/billProposalLimits";
import { snapshotBillPolicyProvisions } from "@/lib/congress/billProposal";
import { resolveTaxSliderProvisionFields } from "@/lib/politicalLegislation/taxSlider";
import { canonicalizeLegislationTypeId } from "@/lib/legislationTypeAliases";
import { getEraContext } from "@/lib/era/context";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import type {
  Bill,
  BillChamber,
  BillStatus,
  BillProvision,
  Character,
  ElectedOfficial,
  LegislationType,
  PoliticalParty,
} from "@/lib/db/types";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import type {
  EmbargoProvision,
  EndEmbargoProvision,
  UnionLawProvision,
} from "@/lib/db/types/legislation";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CommodityType } from "@/lib/constants/commodities";
import type { BillDisplay, BillsResponse } from "@/lib/legislature/dto/billDisplay";
import {
  CATEGORY_TO_POLICY_DOMAINS,
  SUBSIDY_BILL_CATEGORIES,
  NATIONALIZATION_BILL_CATEGORIES,
  UNION_LAW_BILL_CATEGORIES,
  BILL_PROPOSE_ACTION_COST,
  countProvisionsChargedNationalInfluence,
  getProvisionCostTotal,
} from "@shared/constants/legislation";
import {
  UNION_LAW_BIAS_MIN,
  UNION_LAW_BIAS_MAX,
  clampUnionLawBias,
  isUnionLawBanAction,
} from "@/lib/labour/unionLaws";
import { validateNationalizationProvisions } from "@/lib/nationalization/billProvisionValidation";
import type { SubsidyProvision, EndSubsidyProvision } from "@/lib/db/types";
import {
  getBillProposalAutoFailWarning,
  getBillProposalAutoFailWarningError,
  type BillProposalOriginChamber,
} from "@/lib/legislature/billAutoFailWarning";
export type { BillDisplay, BillsResponse } from "@/lib/legislature/dto/billDisplay";

const VOTING_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// GET /api/congress/bills — Returns a paginated list of bills, optionally filtered by chamber and status.
// Auth: public
// Errors: 400
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const chamber = searchParams.get("chamber") ?? undefined;
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
      else query.$or = [{ currentChamber: chamber }, { status: "active_both" }];
    }
    if (statusFilter && statusFilter !== "all") query.status = statusFilter;

    const [bills, parties, legislationTypesList, total] = await Promise.all([
      db
        .collection<Bill>("bills")
        .find(query)
        .project<Bill>({ fullText: 0 })
        .sort({ proposedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      // Congress bills are US-only - filter parties by countryId to avoid cross-country collisions
      db.collection<PoliticalParty>("politicalParties").find({ countryId: "US" }).toArray(),
      db.collection<LegislationType>("legislationTypes").find({}).toArray(),
      db.collection<Bill>("bills").countDocuments(query),
    ]);

    const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));
    const legislationTypeMap = new Map(legislationTypesList.map((lt) => [lt._id, lt]));

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
            officeType: { $in: ["house", "senate"] },
          }),
          db.collection<Bill>("bills").findOne({
            sponsorId: new ObjectId(myCharacterId),
            status: { $nin: TERMINAL_STATUSES },
          }),
        ]);
        inCongress = !!official;
        hasActiveBill = !!activeBill;
        // Congress members can propose only when they have no active bill in flight
        canPropose = inCongress && !hasActiveBill;
        myChamber = official?.officeType as "house" | "senate" | null;
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

// POST /api/congress/bills — Proposes a new bill, opening it immediately for congressional voting.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 429
export async function POST(request: Request) {
  try {
    const start = Date.now();
    const path = new URL(request.url).pathname;
    const auth = await requireBasicAuth();
    if (!auth.ok) {
      logRequest("POST", path, 401, Date.now() - start);
      return auth.response;
    }
    const authUser = auth.user;

    const limit = checkRateLimit(
      `congress:${authUser.userId}`,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!limit.ok) {
      logRequest("POST", path, 429, Date.now() - start);
      return rateLimitResponse(limit.retryAfter);
    }

    const db = await getDb();
    const { year: eraYear } = await getEraContext(db);
    const character = await getCharacterByUserId(db, authUser.userId);
    if (!character) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json({ error: "No character" }, { status: 400 });
    }

    const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: character._id,
      officeType: { $in: ["house", "senate"] },
    });
    const isAdmin = authUser.isAdmin === true;
    const usingAdminOverride = isAdmin && !official;
    if (!official && !isAdmin) {
      logRequest("POST", path, 403, Date.now() - start);
      return NextResponse.json(
        { error: "You must be a sitting member of Congress to propose legislation." },
        { status: 403 }
      );
    }

    // One active bill at a time per player (admins bypass)
    if (!isAdmin) {
      const existingActiveBill = await db.collection<Bill>("bills").findOne({
        sponsorId: character._id,
        status: { $nin: NATIONAL_TERMINAL_STATUSES as BillStatus[] },
      });
      if (existingActiveBill) {
        logRequest("POST", path, 403, Date.now() - start);
        return NextResponse.json(
          {
            error:
              "You already have a bill in progress. Wait for it to pass, fail, or be signed before proposing another.",
          },
          { status: 403 }
        );
      }
    }

    const parsed = await parseJsonBody(request, proposeBillSchema);
    if (!parsed.success) {
      logRequest("POST", path, parsed.status, Date.now() - start);
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const {
      title,
      summary,
      chamber,
      category,
      fullText,
      provisions: clientProvisions,
      confirmElectionRisk,
    } = parsed.data;

    // Custom (flavor/roleplay) bills carry no provisions and have no mechanical
    // effect. Force the provision list empty so a client cannot smuggle real
    // effects in under category:"custom".
    const rawProvisions = category === "custom" ? [] : clientProvisions;

    // proposeBillSchema is country-neutral so country configs can add chamber
    // keys without changing the shared body shape. This route is US-only;
    // reject foreign chamber values before constructing a US bill.
    const US_CONGRESS_CHAMBERS = ["house", "senate", "joint"] as const;
    if (!(US_CONGRESS_CHAMBERS as readonly string[]).includes(chamber)) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json(
        {
          error:
            "Invalid chamber for US Congress. Use /api/country/[code]/legislature/bills for non-US legislatures.",
        },
        { status: 400 }
      );
    }

    // Validate chamber matches user's membership (admins can bypass)
    if (!isAdmin && official) {
      const userChamber = official.officeType; // "house" or "senate"
      if (chamber === "house" && userChamber !== "house") {
        logRequest("POST", path, 403, Date.now() - start);
        return NextResponse.json(
          { error: "Only House members can propose House bills." },
          { status: 403 }
        );
      }
      if (chamber === "senate" && userChamber !== "senate") {
        logRequest("POST", path, 403, Date.now() - start);
        return NextResponse.json(
          { error: "Only Senators can propose Senate bills." },
          { status: 403 }
        );
      }
      // Joint bills can be proposed by either chamber
    }

    // ── State-ownership (nationalization) bills: a dedicated provision family,
    // validated by the shared helper and stored as-is. No policy/tariff/subsidy. ──
    if (NATIONALIZATION_BILL_CATEGORIES.has(category)) {
      const natValidation = await validateNationalizationProvisions(db, rawProvisions, "US");
      if (!natValidation.ok) {
        logRequest("POST", path, natValidation.status, Date.now() - start);
        return NextResponse.json({ error: natValidation.error }, { status: natValidation.status });
      }

      const now = new Date();
      const proposalWarning = await getBillProposalAutoFailWarning(
        db,
        "US",
        chamber as BillProposalOriginChamber,
        now
      );
      if (proposalWarning && !confirmElectionRisk) {
        logRequest("POST", path, 409, Date.now() - start);
        return NextResponse.json(
          {
            error: getBillProposalAutoFailWarningError(proposalWarning),
            autoFailWarning: proposalWarning,
            requiresElectionRiskConfirmation: true,
          },
          { status: 409 }
        );
      }

      const npiCost = getProvisionCostTotal(
        countProvisionsChargedNationalInfluence({
          policyProvisionCount: natValidation.provisions.length,
          subsidyProvisionCount: 0,
        })
      );
      const actionCost = BILL_PROPOSE_ACTION_COST;
      const currentNational = character.nationalInfluence ?? 0;
      if (!isAdmin) {
        const currentActions = character.actions ?? 0;
        if (npiCost > 0 && currentNational < npiCost) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            {
              error: `This bill costs ${npiCost} national political influence (you have ${currentNational.toFixed(0)}).`,
            },
            { status: 400 }
          );
        }
        if (currentActions < actionCost) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            {
              error: `Proposing a bill costs ${actionCost} action points (you have ${currentActions}).`,
            },
            { status: 400 }
          );
        }
        const spendResult = await db.collection<Character>("characters").updateOne(
          {
            _id: character._id,
            actions: { $gte: actionCost },
            ...(npiCost > 0 ? { nationalInfluence: { $gte: npiCost } } : {}),
          },
          {
            $set: {
              ...(npiCost > 0 ? { nationalInfluence: Math.max(0, currentNational - npiCost) } : {}),
              updatedAt: new Date(),
            },
            $inc: { actions: -actionCost },
          }
        );
        if (spendResult.modifiedCount === 0) {
          logRequest("POST", path, 409, Date.now() - start);
          return NextResponse.json(
            { error: "Your actions or national influence changed. Please try again." },
            { status: 409 }
          );
        }
      }

      const votingEndsAt = new Date(now.getTime() + VOTING_DURATION_MS);
      const originChamber: BillChamber = chamber;
      const currentChamber: BillChamber = chamber === "joint" ? "house" : chamber;
      const natBill: Omit<Bill, "_id"> = {
        countryId: "US",
        title: title.trim(),
        summary: summary.trim(),
        ...(fullText?.trim() ? { fullText: fullText.trim() } : {}),
        originChamber,
        currentChamber,
        sponsorId: character._id,
        sponsorName: character.name,
        sponsorParty: character.party ?? undefined,
        ...(usingAdminOverride ? { adminProposed: true } : {}),
        status: "active",
        votesFor: 0,
        votesAgainst: 0,
        votesAbstain: 0,
        votes: {},
        category,
        provisions: natValidation.provisions,
        ...(npiCost > 0 ? { proposalNpiCost: npiCost } : {}),
        ...(!isAdmin ? { proposalActionCost: actionCost } : {}),
        proposedAt: now,
        votingStartedAt: now,
        votingEndsAt,
        createdAt: now,
        updatedAt: now,
      };
      try {
        const result = await db.collection<Omit<Bill, "_id">>("bills").insertOne(natBill);
        logRequest("POST", path, 201, Date.now() - start);
        return NextResponse.json(
          { id: result.insertedId.toString(), message: "Bill proposed — voting is now open." },
          { status: 201 }
        );
      } catch (error) {
        if (!isAdmin) {
          await db.collection<Character>("characters").updateOne(
            { _id: character._id },
            {
              $inc: { actions: actionCost },
              $set: {
                ...(npiCost > 0 ? { nationalInfluence: currentNational } : {}),
                updatedAt: new Date(),
              },
            }
          );
        }
        throw error;
      }
    }

    const allowedDomains = CATEGORY_TO_POLICY_DOMAINS[category] ?? [];
    const validatedPolicyProvisions: {
      legislationTypeId: string;
      policyOptionId?: string;
      effectDirection: number;
      /** Omitted when the provision takes no stance on this axis (0 is not centre, ticket #1116). */
      economic?: number;
      social?: number;
      /** Tax-slider laws (ruling #16): validated rate + rate-labeled snapshots. */
      proposedRate?: number;
      policyOptionNameSnapshot?: string;
      currentPolicyOptionNameSnapshot?: string;
    }[] = [];
    const validatedTariffProvisions: {
      type: "tariff";
      scopeType: "economy_wide" | "sector" | "origin_country" | "corporation";
      targetSectorType?: CorporationType;
      targetOriginCountryId?: CountryId;
      targetCorporationId?: ObjectId;
      rate: number;
    }[] = [];
    const validatedSubsidyProvisions: (SubsidyProvision | EndSubsidyProvision)[] = [];
    const validatedEmbargoProvisions: (EmbargoProvision | EndEmbargoProvision)[] = [];
    const validatedUnionLawProvisions: UnionLawProvision[] = [];
    const validatedElectoralLawProvisions: ElectoralLawProvision[] = [];
    // This is the US Congress route; every bill it creates is countryId "US".
    // Named so the self-embargo guard isn't a bare literal if the route ever
    // becomes country-agnostic.
    const sourceCountry: CountryId = "US";

    // One $in fetch for every referenced legislation type; the per-provision
    // findOne this replaces was N round-trips for an N-provision bill.
    const referencedLtIds = Array.from(
      new Set(
        rawProvisions
          .map((p) =>
            String((p as { legislationTypeId?: unknown })?.legislationTypeId ?? "").trim()
          )
          .filter((id) => id.length > 0)
      )
    );
    const legislationTypeById = new Map(
      (
        await db
          .collection<LegislationType>("legislationTypes")
          .find({ _id: { $in: referencedLtIds } })
          .toArray()
      ).map((lt) => [lt._id, lt])
    );

    for (const rawP of rawProvisions) {
      // Handle electoral-law provisions (franchise + registration access)
      if ("type" in rawP && rawP.type === "electoral_law") {
        const res = validateElectoralLawProvision(rawP, category);
        if (!res.ok) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json({ error: res.error }, { status: 400 });
        }
        validatedElectoralLawProvisions.push(res.provision);
        continue;
      }

      // Handle durable embargo / end_embargo provisions (trade bills only)
      if ("type" in rawP && (rawP.type === "embargo" || rawP.type === "end_embargo")) {
        if (category !== "trade") {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            { error: "Embargo provisions can only be included in trade bills." },
            { status: 400 }
          );
        }
        const p = rawP as {
          type: "embargo" | "end_embargo";
          targetCountry: CountryId;
          commodity: CommodityType | "all";
          direction: "export" | "import" | "both";
          mode?: "block" | "cap";
          cap?: number;
        };
        if (p.targetCountry === sourceCountry) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json({ error: "A country cannot embargo itself." }, { status: 400 });
        }
        if (p.type === "end_embargo") {
          validatedEmbargoProvisions.push({
            type: "end_embargo",
            targetCountry: p.targetCountry,
            commodity: p.commodity,
            direction: p.direction,
          });
        } else {
          const mode = p.mode ?? "block";
          if (mode === "cap" && !(typeof p.cap === "number" && p.cap >= 0)) {
            logRequest("POST", path, 400, Date.now() - start);
            return NextResponse.json(
              { error: "A capped embargo requires a non-negative cap." },
              { status: 400 }
            );
          }
          validatedEmbargoProvisions.push({
            type: "embargo",
            targetCountry: p.targetCountry,
            commodity: p.commodity,
            direction: p.direction,
            mode,
            ...(mode === "cap" && typeof p.cap === "number" ? { cap: p.cap } : {}),
          });
        }
        continue;
      }

      // Handle subsidy / end_subsidy provisions
      if ("type" in rawP && (rawP.type === "subsidy" || rawP.type === "end_subsidy")) {
        if (
          !SUBSIDY_BILL_CATEGORIES.has(
            category as Parameters<typeof SUBSIDY_BILL_CATEGORIES.has>[0]
          )
        ) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            { error: "Subsidy provisions can only be included in industry bills." },
            { status: 400 }
          );
        }
        const p = rawP as {
          type: "subsidy" | "end_subsidy";
          scopeType: "economy_wide" | "sector";
          targetSectorType?: string;
          targetStrategyId?: string;
          domesticOnly?: boolean;
        };
        if (p.scopeType === "sector" && !p.targetSectorType) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            { error: "Sector-scoped subsidy provisions must specify a target sector type." },
            { status: 400 }
          );
        }
        if (p.type === "subsidy") {
          validatedSubsidyProvisions.push({
            type: "subsidy",
            scopeType: p.scopeType,
            ...(p.targetSectorType && { targetSectorType: p.targetSectorType as CorporationType }),
            ...(p.targetStrategyId && { targetStrategyId: p.targetStrategyId }),
            domesticOnly: p.domesticOnly ?? false,
          });
        } else {
          validatedSubsidyProvisions.push({
            type: "end_subsidy",
            scopeType: p.scopeType,
            ...(p.targetSectorType && { targetSectorType: p.targetSectorType as CorporationType }),
            ...(p.targetStrategyId && { targetStrategyId: p.targetStrategyId }),
          });
        }
        continue;
      }

      // Handle union-law provisions (v3 Phase 7b)
      if ("type" in rawP && rawP.type === "union_law") {
        if (
          !UNION_LAW_BILL_CATEGORIES.has(
            category as Parameters<typeof UNION_LAW_BILL_CATEGORIES.has>[0]
          )
        ) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            { error: "Union-law provisions can only be included in industry bills." },
            { status: 400 }
          );
        }
        const p = rawP as { type: "union_law"; bias: number; banAction?: unknown };
        // Union ban (player suggestion #93): mirrors billProposal.ts's arm —
        // a banAction provision is validated on its own and carries bias 0.
        if (p.banAction !== undefined) {
          if (!isUnionLawBanAction(p.banAction)) {
            logRequest("POST", path, 400, Date.now() - start);
            return NextResponse.json(
              { error: 'Union-law ban action must be "ban" or "repeal_ban".' },
              { status: 400 }
            );
          }
          validatedUnionLawProvisions.push({ type: "union_law", bias: 0, banAction: p.banAction });
          continue;
        }
        if (typeof p.bias !== "number" || !Number.isFinite(p.bias)) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            { error: "Union-law provisions must specify a numeric bias." },
            { status: 400 }
          );
        }
        if (p.bias < UNION_LAW_BIAS_MIN || p.bias > UNION_LAW_BIAS_MAX) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            {
              error: `Union-law bias must be between ${UNION_LAW_BIAS_MIN} and ${UNION_LAW_BIAS_MAX}.`,
            },
            { status: 400 }
          );
        }
        validatedUnionLawProvisions.push({ type: "union_law", bias: clampUnionLawBias(p.bias) });
        continue;
      }

      // Handle tariff provisions
      if ("type" in rawP && rawP.type === "tariff") {
        const p = rawP as {
          type: "tariff";
          scopeType: "economy_wide" | "sector" | "origin_country" | "corporation";
          targetSectorType?: CorporationType;
          targetOriginCountryId?: CountryId;
          targetCorporationId?: ObjectId;
          rate: number;
        };

        // Validate trade bills have valid tariff scopes
        if (category !== "trade") {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            { error: "Tariff provisions can only be included in trade bills." },
            { status: 400 }
          );
        }

        // Validate sector scope has targetSectorType
        if (p.scopeType === "sector" && !p.targetSectorType) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            { error: "Sector-scoped tariffs must specify a target sector type." },
            { status: 400 }
          );
        }

        // Validate origin_country scope has targetOriginCountryId
        if (p.scopeType === "origin_country" && !p.targetOriginCountryId) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            { error: "Origin-country-scoped tariffs must specify a target origin country." },
            { status: 400 }
          );
        }

        // Validate corporation scope has targetCorporationId
        if (p.scopeType === "corporation" && !p.targetCorporationId) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            { error: "Corporation-scoped tariffs must specify a target corporation." },
            { status: 400 }
          );
        }

        validatedTariffProvisions.push({
          type: "tariff",
          scopeType: p.scopeType,
          ...(p.targetSectorType && { targetSectorType: p.targetSectorType }),
          ...(p.targetOriginCountryId && { targetOriginCountryId: p.targetOriginCountryId }),
          ...(p.targetCorporationId && {
            targetCorporationId: new ObjectId(p.targetCorporationId),
          }),
          rate: Math.max(0, Math.min(100, p.rate)),
        });
        continue;
      }

      // Handle policy provisions
      const p = rawP as {
        legislationTypeId: string;
        policyOptionId?: string;
        effectDirection: number;
        economic?: number;
        social?: number;
        proposedRate?: number;
      };

      const ltId = String(p?.legislationTypeId ?? "").trim();
      if (!ltId) {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json(
          { error: "Each provision must have a legislation type." },
          { status: 400 }
        );
      }
      const lt = legislationTypeById.get(ltId) ?? null;
      if (!lt) {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json({ error: `Invalid legislation type: ${ltId}.` }, { status: 400 });
      }
      if (!isLegislationTypeActive(lt._id, eraYear)) {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json(
          { error: "This legislation is not available in this era." },
          { status: 400 }
        );
      }
      if (!allowedDomains.includes(lt.policyDomain)) {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json(
          { error: `Legislation type "${lt.name}" is not in the selected category (${category}).` },
          { status: 400 }
        );
      }

      // Tax-slider laws (ruling #16): server-side bounds/grid/min-step
      // validation against the CURRENT rate, with stamped delta-derived fields.
      if (lt.taxSlider) {
        const resolved = await resolveTaxSliderProvisionFields(
          db,
          lt,
          p?.proposedRate,
          typeof p?.policyOptionId === "string" ? p.policyOptionId : undefined,
          "US"
        );
        if (!resolved.ok) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json({ error: resolved.error }, { status: 400 });
        }
        validatedPolicyProvisions.push({
          legislationTypeId: lt._id,
          ...resolved.fields,
        });
        continue;
      }
      const effectDirection =
        p?.effectDirection != null && typeof p.effectDirection === "number"
          ? Math.max(-1, Math.min(1, Math.round(p.effectDirection)))
          : 0;
      // 0 means "no stance on this axis", not a centre target (ticket #1116).
      const economic =
        p?.economic != null && typeof p.economic === "number"
          ? Math.max(-3, Math.min(3, Math.round(p.economic)))
          : undefined;
      const social =
        p?.social != null && typeof p.social === "number"
          ? Math.max(-3, Math.min(3, Math.round(p.social)))
          : undefined;
      const policyOptionId = typeof p?.policyOptionId === "string" ? p.policyOptionId : undefined;
      validatedPolicyProvisions.push({
        legislationTypeId: lt._id,
        ...(policyOptionId && { policyOptionId }),
        effectDirection,
        ...(economic ? { economic } : {}),
        ...(social ? { social } : {}),
      });
    }

    // Validate embargo targets: never self (US), must be an enabled country.
    if (validatedEmbargoProvisions.length > 0) {
      const enabledForEmbargo = new Set(await getEnabledCountryIds());
      for (const provision of validatedEmbargoProvisions) {
        if (!enabledForEmbargo.has(provision.targetCountry)) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            { error: "Embargo target must be an enabled country." },
            { status: 400 }
          );
        }
      }
    }

    // Trade bills carry tariff OR embargo provisions (not both), and no policy.
    if (category === "trade") {
      if (validatedTariffProvisions.length === 0 && validatedEmbargoProvisions.length === 0) {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json(
          { error: "Trade bills must contain at least one tariff or embargo provision." },
          { status: 400 }
        );
      }
      if (validatedTariffProvisions.length > 0 && validatedEmbargoProvisions.length > 0) {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json(
          {
            error: "A trade bill is either tariffs or embargoes — propose them as separate bills.",
          },
          { status: 400 }
        );
      }
      if (validatedPolicyProvisions.length > 0) {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json(
          { error: "Trade bills cannot mix policy provisions with trade restrictions." },
          { status: 400 }
        );
      }
    }

    // Industry bills must contain at least one subsidy or union-law provision
    if (
      category === "industry" &&
      validatedSubsidyProvisions.length === 0 &&
      validatedUnionLawProvisions.length === 0
    ) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json(
        { error: "Industry bills must contain at least one subsidy or union-law provision." },
        { status: 400 }
      );
    }

    // Constraint 2: no duplicate provision at same policy level across active US Congress bills
    const duplicateCheck = await checkDuplicateProvisions(
      db,
      "bills",
      { countryId: "US", status: { $nin: NATIONAL_TERMINAL_STATUSES } },
      validatedPolicyProvisions
    );
    if (duplicateCheck) {
      logRequest("POST", path, 409, Date.now() - start);
      return NextResponse.json({ error: duplicateCheck.error }, { status: 409 });
    }

    const tariffDuplicateCheck = await checkDuplicateTariffProvisions(
      db,
      "bills",
      { countryId: "US", status: { $nin: NATIONAL_TERMINAL_STATUSES } },
      validatedTariffProvisions
    );
    if (tariffDuplicateCheck) {
      logRequest("POST", path, 409, Date.now() - start);
      return NextResponse.json({ error: tariffDuplicateCheck.error }, { status: 409 });
    }

    // Constraint 3: no proposing a law at its current active level
    const currentLevelCheck = await checkCurrentPolicyLevel(
      db,
      "federal",
      validatedPolicyProvisions
    );
    if (currentLevelCheck) {
      logRequest("POST", path, 409, Date.now() - start);
      return NextResponse.json({ error: currentLevelCheck.error }, { status: 409 });
    }

    const snapshottedPolicyProvisions = await snapshotBillPolicyProvisions(
      db,
      { scope: "national", countryId: "US" },
      validatedPolicyProvisions
    );

    const now = new Date();
    const proposalWarning = await getBillProposalAutoFailWarning(
      db,
      "US",
      chamber as BillProposalOriginChamber,
      now
    );
    if (proposalWarning && !confirmElectionRisk) {
      logRequest("POST", path, 409, Date.now() - start);
      return NextResponse.json(
        {
          error: getBillProposalAutoFailWarningError(proposalWarning),
          autoFailWarning: proposalWarning,
          requiresElectionRiskConfirmation: true,
        },
        { status: 409 }
      );
    }

    // NPI cost: policy + subsidy + union-law rows share one ladder; tariffs do not cost NPI
    const influenceProvisionCount = countProvisionsChargedNationalInfluence({
      policyProvisionCount: validatedPolicyProvisions.length,
      subsidyProvisionCount: validatedSubsidyProvisions.length,
      unionLawProvisionCount: validatedUnionLawProvisions.length,
    });
    const npiCost = getProvisionCostTotal(influenceProvisionCount);
    const actionCost = BILL_PROPOSE_ACTION_COST;
    const currentNational = character.nationalInfluence ?? 0;
    if (!isAdmin) {
      const currentActions = character.actions ?? 0;
      if (npiCost > 0 && currentNational < npiCost) {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json(
          {
            error: `This bill costs ${npiCost} national political influence (you have ${currentNational.toFixed(0)}).`,
          },
          { status: 400 }
        );
      }
      if (currentActions < actionCost) {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json(
          {
            error: `Proposing a bill costs ${actionCost} action points (you have ${currentActions}).`,
          },
          { status: 400 }
        );
      }
      const spendResult = await db.collection<Character>("characters").updateOne(
        {
          _id: character._id,
          actions: { $gte: actionCost },
          ...(npiCost > 0 ? { nationalInfluence: { $gte: npiCost } } : {}),
        },
        {
          $set: {
            ...(npiCost > 0 ? { nationalInfluence: Math.max(0, currentNational - npiCost) } : {}),
            updatedAt: new Date(),
          },
          $inc: { actions: -actionCost },
        }
      );
      if (spendResult.modifiedCount === 0) {
        logRequest("POST", path, 409, Date.now() - start);
        return NextResponse.json(
          { error: "Your actions or national influence changed. Please try again." },
          { status: 409 }
        );
      }
    }

    const votingEndsAt = new Date(now.getTime() + VOTING_DURATION_MS);
    const originChamber: BillChamber = chamber;
    const currentChamber: BillChamber = chamber === "joint" ? "house" : chamber;
    const first = snapshottedPolicyProvisions[0];

    // Combine policy, tariff, subsidy, embargo, and union-law provisions for storage
    const allProvisions: BillProvision[] = [
      ...snapshottedPolicyProvisions,
      ...validatedTariffProvisions,
      ...validatedSubsidyProvisions,
      ...validatedEmbargoProvisions,
      ...validatedUnionLawProvisions,
      ...validatedElectoralLawProvisions,
    ];

    const bill: Omit<Bill, "_id"> = {
      countryId: "US",
      title: title.trim(),
      summary: summary.trim(),
      ...(fullText?.trim() ? { fullText: fullText.trim() } : {}),
      originChamber,
      currentChamber,
      sponsorId: character._id,
      sponsorName: character.name,
      sponsorParty: character.party ?? undefined,
      ...(usingAdminOverride ? { adminProposed: true } : {}),
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      category,
      provisions: allProvisions,
      legislationTypeId: first?.legislationTypeId ?? null,
      effectDirection: first?.effectDirection ?? null,
      ...(npiCost > 0 ? { proposalNpiCost: npiCost } : {}),
      ...(!isAdmin ? { proposalActionCost: actionCost } : {}),
      proposedAt: now,
      votingStartedAt: now,
      votingEndsAt,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const result = await db.collection<Omit<Bill, "_id">>("bills").insertOne(bill);
      try {
        const { checkBillSponsoredAchievements } = await import("@/lib/achievements/triggers");
        await checkBillSponsoredAchievements(new ObjectId(authUser.userId), character._id);
      } catch (e) {
        console.error(
          JSON.stringify({
            error: "achievement_check_failed",
            operation: "bill_sponsored_achievement",
            timestamp: new Date().toISOString(),
            details: e instanceof Error ? e.message : "Unknown error",
          })
        );
      }
      logRequest("POST", path, 201, Date.now() - start);
      return NextResponse.json(
        { id: result.insertedId.toString(), message: "Bill proposed — voting is now open." },
        { status: 201 }
      );
    } catch (error) {
      if (!isAdmin) {
        await db.collection<Character>("characters").updateOne(
          { _id: character._id },
          {
            $inc: { actions: actionCost },
            $set: {
              ...(npiCost > 0 ? { nationalInfluence: currentNational } : {}),
              updatedAt: new Date(),
            },
          }
        );
      }
      throw error;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
