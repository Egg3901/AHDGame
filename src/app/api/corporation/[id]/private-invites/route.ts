/**
 * Private share invitation endpoints for close-corporation (e.g. S-Corp) flow.
 *
 * GET  /api/corporation/[id]/private-invites — list pending invites for this corp.
 *      CEO sees all pending invites; everyone else sees only invites addressed
 *      to their active character.
 * POST /api/corporation/[id]/private-invites — CEO creates a new invite.
 *
 * Gates:
 *  - The corporation must be private (`isPrivate: true`).
 *  - The corporation's legal structure must declare `maxShareholders > 1`
 *    (e.g. `us_s_corp` = 100).
 *  - The invitee must not already be a shareholder.
 *  - Current shareholder count + outstanding pending invites < maxShareholders.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getLegalStructureForCorp } from "@/lib/corporations/legalStructure";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { createNotification } from "@/lib/notifications";
import type { Character, Corporation, CorporationShareInvite, User } from "@/lib/db/types";

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const inviteSchema = z.object({
  invitedCharacterId: z.string().min(1),
  shares: z.number().int().positive().max(1_000_000),
  pricePerShare: z.number().positive().max(1_000_000_000),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

function shareholderCount(corp: Corporation): number {
  return (corp.shareholders ?? []).filter((sh) => (sh.shares ?? 0) > 0).length;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    const isCeo = !ceoCheck;

    const characterFilter: Record<string, unknown> = {
      corporationId: corporation._id,
      status: "pending",
      expiresAt: { $gt: new Date() },
    };

    if (!isCeo) {
      // Restrict to invites addressed to the caller's active character.
      const userDoc = await db
        .collection<User>("users")
        .findOne({ _id: new ObjectId(auth.user.userId) });
      const characterId = userDoc?.activeCharacterId;
      if (!characterId) {
        return NextResponse.json({ invites: [] });
      }
      characterFilter.invitedCharacterId = characterId;
    }

    const invites = await db
      .collection<CorporationShareInvite>("corporationShareInvites")
      .find(characterFilter)
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json({
      invites: invites.map((inv) => ({
        id: inv._id.toString(),
        invitedCharacterId: inv.invitedCharacterId.toString(),
        invitedCharacterName: inv.invitedCharacterName,
        issuedByCharacterName: inv.issuedByCharacterName,
        shares: inv.shares,
        pricePerShare: inv.pricePerShare,
        totalCost: inv.totalCost,
        currencyCode: inv.currencyCode,
        status: inv.status,
        expiresAt: inv.expiresAt.toISOString(),
        createdAt: inv.createdAt.toISOString(),
      })),
      isCeo,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`share-invite:${auth.user.userId}`, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, inviteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { invitedCharacterId, shares, pricePerShare } = parsed.data;

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!corporation.isPrivate) {
      return NextResponse.json(
        {
          error:
            "Private share invitations are for private corporations only. Public corps issue shares through the market.",
        },
        { status: 400 }
      );
    }

    const legalStructure = getLegalStructureForCorp(corporation);
    const maxShareholders = legalStructure.maxShareholders ?? 1;
    if (maxShareholders <= 1) {
      return NextResponse.json(
        {
          error: `${legalStructure.name} corporations are CEO-only and cannot bring in outside shareholders. Convert to an S-Corp (or similar) to enable private placements.`,
        },
        { status: 400 }
      );
    }

    if (!ObjectId.isValid(invitedCharacterId)) {
      return NextResponse.json({ error: "Invalid invitedCharacterId" }, { status: 400 });
    }
    const inviteeId = new ObjectId(invitedCharacterId);

    if (corporation.ceoId && inviteeId.equals(corporation.ceoId)) {
      return NextResponse.json({ error: "CEO is already the sole shareholder" }, { status: 400 });
    }

    const invitee = await db.collection<Character>("characters").findOne({ _id: inviteeId });
    if (!invitee) {
      return NextResponse.json({ error: "Invited character not found" }, { status: 404 });
    }

    const existingShareholder = (corporation.shareholders ?? []).find(
      (sh) => sh.characterId?.toString() === invitedCharacterId && (sh.shares ?? 0) > 0
    );
    if (existingShareholder) {
      return NextResponse.json(
        { error: `${invitee.name} is already a shareholder of this corporation.` },
        { status: 400 }
      );
    }

    const now = new Date();
    // Count current shareholders plus any outstanding pending invites — both
    // consume the cap. A pending invite that's accepted will land a new holder.
    const pendingInviteCount = await db
      .collection<CorporationShareInvite>("corporationShareInvites")
      .countDocuments({
        corporationId: corporation._id,
        status: "pending",
        expiresAt: { $gt: now },
      });
    const projected = shareholderCount(corporation) + pendingInviteCount + 1;
    if (projected > maxShareholders) {
      return NextResponse.json(
        {
          error: `Adding another shareholder would exceed the ${legalStructure.name} cap of ${maxShareholders} shareholders (${shareholderCount(corporation)} current + ${pendingInviteCount} pending).`,
        },
        { status: 400 }
      );
    }

    // Validate that the corp has enough authorized-but-unissued shares to back
    // this invite. Mirrors the IPO/secondary-offering invariant: newly issued
    // shares come from the unissued pool, not from existing holders.
    const totalShares = corporation.totalShares ?? 0;
    const issuedToShareholders = (corporation.shareholders ?? []).reduce(
      (sum, sh) => sum + (sh.shares ?? 0),
      0
    );
    const issued = issuedToShareholders + (corporation.publicFloat ?? 0);
    const unissued = Math.max(0, totalShares - issued);

    // Outstanding pending invites reserve unissued capacity to prevent over-
    // promising the same pool.
    const reservedByInvites = await db
      .collection<CorporationShareInvite>("corporationShareInvites")
      .aggregate<{ total: number }>([
        {
          $match: {
            corporationId: corporation._id,
            status: "pending",
            expiresAt: { $gt: now },
          },
        },
        { $group: { _id: null, total: { $sum: "$shares" } } },
      ])
      .toArray();
    const reserved = reservedByInvites[0]?.total ?? 0;
    const available = unissued - reserved;
    if (shares > available) {
      return NextResponse.json(
        {
          error: `Only ${available.toLocaleString()} unissued shares available (after reserving ${reserved.toLocaleString()} for other pending invites).`,
        },
        { status: 400 }
      );
    }

    const issuingCharacterId = corporation.ceoId ?? new ObjectId(auth.user.userId);
    const issuingCharacter = corporation.ceoId
      ? await db.collection<Character>("characters").findOne({ _id: corporation.ceoId })
      : null;

    const invite: CorporationShareInvite = {
      _id: new ObjectId(),
      corporationId: corporation._id,
      corporationName: corporation.name,
      invitedCharacterId: inviteeId,
      invitedCharacterName: invitee.name,
      issuedByCharacterId: issuingCharacterId,
      issuedByCharacterName: issuingCharacter?.name ?? "CEO",
      shares,
      pricePerShare,
      totalCost: shares * pricePerShare,
      currencyCode: corporation.liquidCurrencyCode ?? "USD",
      status: "pending",
      expiresAt: new Date(now.getTime() + INVITE_EXPIRY_MS),
      createdAt: now,
      updatedAt: now,
    };

    await db.collection<CorporationShareInvite>("corporationShareInvites").insertOne(invite);

    await createNotification({
      userId: invitee.userId,
      type: "share_invite_received",
      title: `Private share offer from ${corporation.name}`,
      message: `${invite.issuedByCharacterName} has offered you ${shares.toLocaleString()} shares at ${invite.currencyCode} ${pricePerShare.toLocaleString()}/share (total ${invite.currencyCode} ${invite.totalCost.toLocaleString()}). Review on the corporation page.`,
      metadata: {
        corporationId: corporation._id.toString(),
        inviteId: invite._id.toString(),
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      inviteId: invite._id.toString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
