import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import type { Corporation, State } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { openCeoTenure } from "@/lib/corporations/ceoHistory";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { holdsAnyBondsInCorp } from "@/lib/bonds/ceoBondConflict";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/ceo/accept
 * Accept the offered CEO position. User must be the pending CEO candidate.
 * User may only be CEO of one corporation at a time.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    if (!corporation.pendingCeoCharacterId) {
      return NextResponse.json(
        { error: "No CEO offer is pending for this corporation" },
        { status: 400 }
      );
    }

    const myChar = auth.user.character;

    // Verify this user is the one being offered the position
    if (corporation.pendingCeoCharacterId.toString() !== myChar._id.toString()) {
      return NextResponse.json(
        { error: "You have not been offered the CEO position" },
        { status: 403 }
      );
    }

    // Residency rule depends on ownership. A National Corporation is a
    // country-wide state instrument, so its CEO need only reside in the same
    // COUNTRY (any state). A private corp keeps the stricter HQ-state rule.
    if (isStateOwned(corporation)) {
      if (corporation.countryId && myChar.countryId !== corporation.countryId) {
        return NextResponse.json(
          {
            error:
              "You must reside in this country to accept the National Corporation CEO position.",
          },
          { status: 400 }
        );
      }
    } else {
      // Enforce CEO must reside in HQ state
      if (myChar.homeState !== corporation.headquartersState) {
        // Look up HQ state name for a friendly error message
        const hqState = await db
          .collection<State>("states")
          .findOne({ _id: corporation.headquartersState });
        const hqName = hqState?.name ?? corporation.headquartersState;
        return NextResponse.json(
          {
            error: `You must reside in ${hqName} to accept the CEO position. Relocate to the headquarters state first.`,
          },
          { status: 400 }
        );
      }

      if (corporation.countryId && myChar.countryId !== corporation.countryId) {
        return NextResponse.json(
          {
            error:
              "You must be in the same country as this corporation to accept the CEO position.",
          },
          { status: 400 }
        );
      }
    }

    // Enforce one CEO per character: check if this character is already CEO of another active corporation
    const existingCeo = await db.collection<Corporation>("corporations").findOne({
      ceoId: myChar._id,
      ceoVacant: { $ne: true },
      _id: { $ne: corporation._id },
    });
    if (existingCeo) {
      return NextResponse.json(
        {
          error: `You are already CEO of ${existingCeo.name}. You must resign from that position before accepting another.`,
        },
        { status: 409 }
      );
    }

    // A creditor cannot also control the corp: block accepting the CEO seat
    // while holding any of this corporation's bonds. See the CEO ⊥ bondholder
    // invariant design.
    const bondConflict = await holdsAnyBondsInCorp(db, myChar._id, "characterId", corporation._id);
    if (bondConflict.holds) {
      return NextResponse.json(
        {
          error: `You hold ${bondConflict.units.toLocaleString()} units of this corporation's bonds. Sell them before taking the CEO seat.`,
        },
        { status: 400 }
      );
    }

    const now = new Date();

    // Install new CEO. `ceoType` MUST be stamped, not just left alone: the seat
    // may previously have been held by an NPP (spawned or caretaker) or an
    // imperial character, and corporationDetail resolves the CEO from the
    // collection named by `ceoType`. A stale "npp" makes the corp page render
    // "CEO Vacant" while a live character sits in `ceoId`. Any caretaker record
    // dies with the handover — leaving it would let a later dismissal restore
    // the old human over the one just seated.
    await db.collection<Corporation>("corporations").updateOne(
      { _id: corporation._id },
      {
        $set: {
          ceoId: myChar._id,
          ceoType: "character",
          userId: new ObjectId(auth.user.userId),
          ceoVacant: false,
          updatedAt: now,
        },
        $unset: { pendingCeoCharacterId: "", caretakerCeo: "" },
      }
    );

    await openCeoTenure(db, corporation._id, {
      holderId: myChar._id,
      ceoType: "character",
      turn: await getCurrentTurn(db),
    });

    // Notify the new CEO
    await createNotification({
      userId: new ObjectId(auth.user.userId),
      type: "ceo_elected",
      title: "You are now CEO",
      message: `You have accepted the CEO position at ${corporation.name}. Welcome aboard!`,
      metadata: {
        corporationId: corporation._id.toString(),
        corporationSequentialId: corporation.sequentialId,
        corporationName: corporation.name,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
