/**
 * GET  /api/admin/country/[code]/bills          — list bills with filters
 * POST /api/admin/country/[code]/bills          — force actions: sign | veto | reset | advance
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseBoundedIntParam, parseJsonBody } from "@/lib/api/validate";
import { adminBillsSchema } from "@/lib/api/schemas/admin";
import { handleRouteError } from "@/lib/api/errors";
import { onBillEnacted } from "@/lib/billEnactment";
import { applyLegislationEffect } from "@/lib/legislationEffects";
import { claimStatusTransition } from "@/lib/turn/atomicClaim";
import { notifyPresidentBillAwaitingSignature } from "@/lib/billLifecycle";
import { getGameState } from "@/lib/gameState";
import type { Bill, LegislationType, GameState } from "@/lib/db/types";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

const PRESIDENT_ACTION_MS = 10 * 60 * 60 * 1000;
const VOTING_DURATION_HOURS = 24;
const VOTING_DURATION_MS = VOTING_DURATION_HOURS * 60 * 60 * 1000;

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") ?? undefined;
    const chamber = searchParams.get("chamber") ?? undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = parseBoundedIntParam(searchParams, "limit", 10, 1, 100);

    const db = await getDb();
    const query: Record<string, unknown> = {};
    if (status) query.status = status;
    if (chamber) {
      // Admin chamber filters should track the chamber currently handling the bill,
      // not just where it started, so advanced bills appear in the correct queue.
      if (chamber === "joint") query.originChamber = "joint";
      else query.currentChamber = chamber;
    }

    // Country filter using the countryId field on bill documents
    query.countryId = countryId;

    const collection = db.collection<Bill>("bills");
    const [bills, total] = await Promise.all([
      collection
        .find(query)
        .sort({ proposedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    // Only fetch legislation types referenced by bills (avoids loading full collection)
    const legTypeIds = new Set<string>();
    for (const b of bills) {
      if (b.legislationTypeId) legTypeIds.add(b.legislationTypeId);
      for (const p of b.provisions ?? []) {
        if (isPolicyProvision(p) && p.legislationTypeId) legTypeIds.add(p.legislationTypeId);
      }
    }
    const legislationTypes =
      legTypeIds.size > 0
        ? await db
            .collection<LegislationType>("legislationTypes")
            .find({ _id: { $in: [...legTypeIds] } })
            .project({ _id: 1, name: 1 })
            .toArray()
        : [];
    const ltMap = new Map(legislationTypes.map((lt) => [lt._id, lt]));

    return NextResponse.json({
      bills: bills.map((b) => ({
        id: b._id.toString(),
        title: b.title,
        status: b.status,
        originChamber: b.originChamber,
        currentChamber: b.currentChamber,
        sponsorName: b.sponsorName,
        legislationTypeId: b.legislationTypeId ?? null,
        legislationTypeName: b.legislationTypeId
          ? (ltMap.get(b.legislationTypeId)?.name ?? null)
          : null,
        effectDirection: b.effectDirection ?? null,
        votesFor: b.votesFor,
        votesAgainst: b.votesAgainst,
        votesAbstain: b.votesAbstain,
        otherChamberVotesFor: b.otherChamberVotesFor ?? 0,
        otherChamberVotesAgainst: b.otherChamberVotesAgainst ?? 0,
        proposedAt: b.proposedAt.toISOString(),
        votingEndsAt: b.votingEndsAt?.toISOString() ?? null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    // Consume the path param (not used for POST but required by Next.js)
    await params;

    const parsed = await parseJsonBody(request, adminBillsSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action, billId } = parsed.data;

    const db = await getDb();
    const bill = await db.collection<Bill>("bills").findOne({ _id: new ObjectId(billId) });
    if (!bill) return NextResponse.json({ error: "Bill not found." }, { status: 404 });

    const now = new Date();

    if (action === "force_sign") {
      // Atomically claim the enactment so a double-submit (or a turn phase
      // enacting the same bill) cannot double-apply effects / double-announce.
      const claimed = await claimStatusTransition(
        db,
        "bills",
        { _id: bill._id, status: bill.status },
        { $set: { status: "signed", presidentAction: "signed", enactedAt: now, updatedAt: now } }
      );
      if (!claimed) {
        return NextResponse.json({ message: `"${bill.title}" was already signed.` });
      }

      await applyLegislationEffect(db, bill).catch((err) =>
        console.error("Legislation effect apply failed (admin force-sign):", err)
      );

      // Get current turn and record bill enactment
      const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
      if (gameState) {
        await onBillEnacted(db, bill, gameState.currentTurn).catch((err) =>
          console.error("Bill enactment hook failed (admin force-sign):", err)
        );
      }

      return NextResponse.json({ message: `"${bill.title}" force-signed.` });
    }

    if (action === "force_veto") {
      await db
        .collection<Bill>("bills")
        .updateOne(
          { _id: bill._id },
          { $set: { status: "vetoed", presidentAction: "vetoed", updatedAt: now } }
        );
      return NextResponse.json({ message: `"${bill.title}" force-vetoed.` });
    }

    if (action === "force_fail") {
      await db
        .collection<Bill>("bills")
        .updateOne(
          { _id: bill._id },
          { $set: { status: "failed", failedAt: now, updatedAt: now } }
        );
      return NextResponse.json({ message: `"${bill.title}" marked as failed.` });
    }

    if (action === "force_enroll") {
      // Skip remaining chamber and send directly to president
      const deadline = new Date(now.getTime() + PRESIDENT_ACTION_MS);
      await db.collection<Bill>("bills").updateOne(
        { _id: bill._id },
        {
          $set: {
            status: "enrolled",
            sentToPresidentAt: now,
            presidentActionDeadline: deadline,
            updatedAt: now,
          },
        }
      );
      await notifyPresidentBillAwaitingSignature(db, bill);
      return NextResponse.json({ message: `"${bill.title}" sent to president.` });
    }

    if (action === "force_advance_chamber") {
      // Move from active → active_other regardless of votes
      const origin = bill.originChamber as "house" | "senate" | "joint";
      if (origin === "joint") {
        return NextResponse.json(
          { error: "Joint bills cannot be advanced this way." },
          { status: 400 }
        );
      }
      const nextChamber = origin === "house" ? "senate" : "house";
      const otherEndsAt = new Date(now.getTime() + VOTING_DURATION_MS);
      const advanceGameState = await getGameState(db);
      const otherEndsOnTurn = (advanceGameState?.currentTurn ?? 0) + VOTING_DURATION_HOURS;
      await db.collection<Bill>("bills").updateOne(
        { _id: bill._id },
        {
          $set: {
            status: "active_other",
            currentChamber: nextChamber,
            passedOriginAt: now,
            sentToOtherChamberAt: now,
            otherChamberVotingStartedAt: now,
            otherChamberVotingEndsAt: otherEndsAt,
            otherChamberVotingEndsOnTurn: otherEndsOnTurn,
            otherChamberVotesFor: 0,
            otherChamberVotesAgainst: 0,
            otherChamberVotesAbstain: 0,
            otherChamberVotes: {},
            updatedAt: now,
          },
        }
      );
      return NextResponse.json({ message: `"${bill.title}" advanced to ${nextChamber}.` });
    }

    if (action === "reset") {
      // Reset to active with fresh voting window (useful for testing)
      const votingEndsAt = new Date(now.getTime() + VOTING_DURATION_MS);
      const resetGameState = await getGameState(db);
      const votingEndsOnTurn = (resetGameState?.currentTurn ?? 0) + VOTING_DURATION_HOURS;
      const origin = bill.originChamber as "house" | "senate" | "joint";
      const currentChamber = origin === "joint" ? "house" : origin;
      await db.collection<Bill>("bills").updateOne(
        { _id: bill._id },
        {
          $set: {
            status: "active",
            originChamber: origin,
            currentChamber,
            votesFor: 0,
            votesAgainst: 0,
            votesAbstain: 0,
            votes: {},
            votingStartedAt: now,
            votingEndsAt,
            votingEndsOnTurn,
            updatedAt: now,
          },
          $unset: {
            passedOriginAt: "",
            sentToOtherChamberAt: "",
            otherChamberVotingStartedAt: "",
            otherChamberVotingEndsAt: "",
            otherChamberVotingEndsOnTurn: "",
            otherChamberVotesFor: "",
            otherChamberVotesAgainst: "",
            otherChamberVotesAbstain: "",
            otherChamberVotes: "",
            sentToPresidentAt: "",
            presidentActionDeadline: "",
            presidentAction: "",
            enactedAt: "",
            failedAt: "",
          },
        }
      );
      return NextResponse.json({ message: `"${bill.title}" reset to active voting.` });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (error) {
    return handleRouteError(error);
  }
}
