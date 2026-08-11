/**
 * Single-invite actions:
 *  POST /api/corporation/[id]/private-invites/[inviteId]
 *    { action: "accept" | "decline" | "cancel" }
 *
 *  - accept: invitee pays cash (atomically) and receives the shares; corp gets cash.
 *  - decline: invitee passes; invite is closed.
 *  - cancel: CEO retracts an outstanding invite.
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
import { creditShares } from "@/lib/corporations/shareholderOps";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
} from "@/lib/financialTxLog/atomicCashGuard";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { createNotification } from "@/lib/notifications";
import { emitTx } from "@/lib/financialTxLog/emit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import type { Character, CorporationShareInvite, User } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";

const actionSchema = z.object({
  action: z.enum(["accept", "decline", "cancel"]),
});

interface RouteParams {
  params: Promise<{ id: string; inviteId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id, inviteId } = await params;
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, actionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action } = parsed.data;

    if (!ObjectId.isValid(inviteId)) {
      return NextResponse.json({ error: "Invalid inviteId" }, { status: 400 });
    }
    const inviteOid = new ObjectId(inviteId);

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const invite = await db
      .collection<CorporationShareInvite>("corporationShareInvites")
      .findOne({ _id: inviteOid, corporationId: corporation._id });
    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    if (invite.status !== "pending") {
      return NextResponse.json({ error: `Invite is already ${invite.status}` }, { status: 409 });
    }
    const now = new Date();
    if (invite.expiresAt <= now) {
      // Lazy-mark expired
      await db
        .collection<CorporationShareInvite>("corporationShareInvites")
        .updateOne({ _id: inviteOid }, { $set: { status: "expired", updatedAt: now } });
      return NextResponse.json({ error: "Invite has expired" }, { status: 410 });
    }

    if (action === "cancel") {
      const ceoCheck = requireCeo(corporation, auth.user.userId);
      if (ceoCheck) return ceoCheck;
      await db
        .collection<CorporationShareInvite>("corporationShareInvites")
        .updateOne(
          { _id: inviteOid, status: "pending" },
          { $set: { status: "cancelled", cancelledAt: now, updatedAt: now } }
        );
      const invitee = await db
        .collection<Character>("characters")
        .findOne({ _id: invite.invitedCharacterId });
      if (invitee) {
        createNotification({
          userId: invitee.userId,
          type: "share_invite_cancelled",
          title: `Share offer from ${corporation.name} cancelled`,
          message: `The ${invite.shares.toLocaleString()}-share offer was withdrawn before you could respond.`,
          metadata: { corporationId: corporation._id.toString(), inviteId: invite._id.toString() },
        }).catch(() => {});
      }
      return NextResponse.json({ success: true });
    }

    // decline / accept: caller must be the invitee.
    const userDoc = await db
      .collection<User>("users")
      .findOne({ _id: new ObjectId(auth.user.userId) });
    const callerCharacterId = userDoc?.activeCharacterId;
    if (!callerCharacterId || !callerCharacterId.equals(invite.invitedCharacterId)) {
      return NextResponse.json(
        { error: "Only the invitee can accept or decline" },
        { status: 403 }
      );
    }

    if (action === "decline") {
      await db
        .collection<CorporationShareInvite>("corporationShareInvites")
        .updateOne(
          { _id: inviteOid, status: "pending" },
          { $set: { status: "declined", declinedAt: now, updatedAt: now } }
        );
      const ceoId = corporation.ceoId;
      if (ceoId) {
        const ceo = await db.collection<Character>("characters").findOne({ _id: ceoId });
        if (ceo) {
          createNotification({
            userId: ceo.userId,
            type: "share_invite_declined",
            title: `${invite.invitedCharacterName} declined your share offer`,
            message: `${invite.invitedCharacterName} declined the ${invite.shares.toLocaleString()}-share offer in ${corporation.name}.`,
            metadata: {
              corporationId: corporation._id.toString(),
              inviteId: invite._id.toString(),
            },
          }).catch(() => {});
        }
      }
      return NextResponse.json({ success: true });
    }

    // action === "accept": atomic flow — re-check cap and unissued capacity,
    // debit invitee cash, credit shares, credit corp liquidCapital.
    const invitee = await db
      .collection<Character>("characters")
      .findOne({ _id: invite.invitedCharacterId });
    if (!invitee) {
      return NextResponse.json({ error: "Invitee character not found" }, { status: 404 });
    }

    const legalStructure = getLegalStructureForCorp(corporation);
    const maxShareholders = legalStructure.maxShareholders ?? 1;
    const currentShareholders = (corporation.shareholders ?? []).filter(
      (sh) => (sh.shares ?? 0) > 0
    ).length;
    if (currentShareholders + 1 > maxShareholders) {
      return NextResponse.json(
        {
          error: `Shareholder cap of ${maxShareholders} has been reached since the invite was sent.`,
        },
        { status: 409 }
      );
    }

    const homeCurrency = getHomeCurrency(invitee) as CurrencyCode;
    const corpCurrency = (corporation.liquidCurrencyCode ?? "USD") as CurrencyCode;
    if (homeCurrency !== corpCurrency) {
      return NextResponse.json(
        {
          error: `Cross-currency private placements aren't supported yet. Your wallet is ${homeCurrency} but the offer is denominated in ${corpCurrency}.`,
        },
        { status: 400 }
      );
    }

    const forexEnabled = await isForexEnabled();
    const debitResult = await atomicallyDebitCharacterCash(
      db,
      invitee._id,
      homeCurrency,
      invite.totalCost,
      forexEnabled
    );
    if (!debitResult.ok) {
      return NextResponse.json(
        {
          error: `Insufficient funds. Need ${invite.totalCost.toLocaleString()} ${homeCurrency}.`,
        },
        { status: 400 }
      );
    }

    let sharesCredited = false;
    try {
      const credited = await creditShares(
        db,
        corporation._id,
        invitee._id,
        invite.shares,
        {
          $inc: { liquidCapital: invite.totalCost },
          $set: { updatedAt: now },
        },
        { pricePerShare: invite.pricePerShare }
      );
      if (!credited) {
        await refundCharacterCash(db, invitee._id, homeCurrency, invite.totalCost, forexEnabled);
        return NextResponse.json(
          { error: "Failed to credit shares — please retry" },
          { status: 500 }
        );
      }
      sharesCredited = true;

      await db
        .collection<CorporationShareInvite>("corporationShareInvites")
        .updateOne(
          { _id: inviteOid, status: "pending" },
          { $set: { status: "accepted", acceptedAt: now, updatedAt: now } }
        );

      emitTx(db, {
        type: "stock_trade_buy",
        turn: await getCurrentTurn(db),
        createdAt: now,
        subjectType: "character",
        subjectId: invitee._id,
        subjectName: invitee.name,
        amount: -invite.totalCost,
        balanceAfter: debitResult.newBalance,
        currencyCode: homeCurrency,
        counterpartyType: "corporation",
        counterpartyId: corporation._id,
        counterpartyName: corporation.name,
        meta: {
          privatePlacement: true,
          inviteId: invite._id.toString(),
          shares: invite.shares,
          pricePerShare: invite.pricePerShare,
        },
      }).catch(() => {});

      if (corporation.ceoId) {
        const ceo = await db
          .collection<Character>("characters")
          .findOne({ _id: corporation.ceoId });
        if (ceo) {
          createNotification({
            userId: ceo.userId,
            type: "share_invite_accepted",
            title: `${invitee.name} accepted your share offer`,
            message: `${invitee.name} purchased ${invite.shares.toLocaleString()} shares of ${corporation.name} for ${invite.currencyCode} ${invite.totalCost.toLocaleString()}.`,
            metadata: {
              corporationId: corporation._id.toString(),
              inviteId: invite._id.toString(),
            },
          }).catch(() => {});
        }
      }
    } catch (err) {
      if (sharesCredited) {
        // Best-effort rollback path; logged for ops review.
        console.error("[private-invite accept] failed after credit", err);
      } else {
        await refundCharacterCash(db, invitee._id, homeCurrency, invite.totalCost, forexEnabled);
      }
      throw err;
    }

    return NextResponse.json({
      success: true,
      shares: invite.shares,
      totalCost: invite.totalCost,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
