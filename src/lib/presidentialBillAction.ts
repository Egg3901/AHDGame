/**
 * Shared logic for presidential sign/veto on bills.
 * Used by congress bills route and whitehouse bills route.
 */
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Bill, Character, ElectedOfficial, GameState } from "@/lib/db/types";
import { recordAudit } from "@/lib/audit/recordAudit";
import { applyLegislationEffect } from "@/lib/legislationEffects";
import { createNotification } from "@/lib/notifications";
import { validateBudgetImpact } from "./budget/validation";
import { triggerDebtCeilingCrisis } from "./budget/debt";
import { onBillEnacted } from "@/lib/billEnactment";
import { generateBillSignedNews, generateBillVetoedNews } from "@/lib/news";
import { sendCountryGameEvent, buildBillVetoedDiscordEmbed } from "@/lib/discordWebhooks";
import { claimStatusTransition } from "@/lib/turn/atomicClaim";

const OVERRIDE_WINDOW_HOURS = 24;
const OVERRIDE_WINDOW_MS = OVERRIDE_WINDOW_HOURS * 60 * 60 * 1000;

export type PresidentialDecision = "sign" | "veto";

export interface PresidentialActionResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Execute presidential sign or veto on an enrolled bill.
 * Caller must verify the character is the President.
 */
export async function executePresidentialBillAction(
  db: Db,
  billId: ObjectId,
  characterId: ObjectId,
  decision: PresidentialDecision,
  vetoMessage?: string
): Promise<PresidentialActionResult> {
  const now = new Date();

  const bill = await db.collection<Bill>("bills").findOne({ _id: billId });
  if (!bill) {
    return { success: false, message: "", error: "Bill not found" };
  }
  if (bill.status !== "enrolled") {
    return { success: false, message: "", error: "This bill is not awaiting presidential action." };
  }

  if (decision === "sign") {
    // Validate budget impact before signing
    if (bill.legislationTypeId || bill.provisions?.length) {
      const budgetResult = await validateBudgetImpact(db, bill, "national");

      if (!budgetResult.allowed) {
        return {
          success: false,
          message: "",
          error: `Cannot sign: ${budgetResult.error}. Shortfall: $${Math.round((budgetResult.shortfall || 0) / 1000000000)}B`,
        };
      }

      if (budgetResult.warning === "DEBT_CEILING_EXCEEDED") {
        const gameState = await db.collection<GameState>("gameState").findOne({ _id: "main" });
        await triggerDebtCeilingCrisis(db, gameState?.currentYear || 2024);
      }
    }

    // Atomically claim the enrolled→signed transition so a concurrent action
    // (double-submit, or a turn-phase pocket-sign racing this route) cannot
    // enact and announce the same bill twice.
    const claimed = await claimStatusTransition(
      db,
      "bills",
      { _id: billId, status: "enrolled" },
      { $set: { status: "signed", presidentAction: "signed", enactedAt: now, updatedAt: now } }
    );
    if (!claimed) {
      return {
        success: false,
        message: "",
        error: "This bill is not awaiting presidential action.",
      };
    }
    await applyLegislationEffect(db, bill).catch((err) =>
      console.error("Legislation effect apply failed:", err)
    );

    // Call bill enactment hook (applies tax rate changes, policy updates, etc.)
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 1;
    await onBillEnacted(db, bill, currentTurn).catch((err) =>
      console.error("Bill enactment hook failed (president sign):", err)
    );

    if (bill.sponsorId) {
      try {
        const { awardAchievement, resolveUserIdFromCharacter } = await import("@/lib/achievements");
        const sponsorUserId = await resolveUserIdFromCharacter(bill.sponsorId);
        if (sponsorUserId) {
          await awardAchievement(sponsorUserId, "lawmaker", bill.sponsorId);
        }
      } catch (e) {
        console.error("Achievement check failed:", e);
      }
      const sponsor = await db
        .collection<Character>("characters")
        .findOne({ _id: bill.sponsorId }, { projection: { userId: 1 } });
      if (sponsor?.userId) {
        await createNotification({
          userId: sponsor.userId,
          type: "bill_signed",
          title: "Bill Signed Into Law",
          message: `"${bill.title}" has been signed into law.`,
          metadata: { billId: bill._id.toString() },
        });
      }
    }
    // Generate system news (fire-and-forget). bill.sponsorName is the source
    // of truth (always set on creation); use it as the fallback when the
    // character row is missing or sponsorId is null (e.g. admin-proposed bills).
    const sponsorName = bill.sponsorId
      ? ((
          await db
            .collection<Character>("characters")
            .findOne({ _id: bill.sponsorId }, { projection: { name: 1 } })
        )?.name ??
        bill.sponsorName ??
        "Unknown")
      : (bill.sponsorName ?? "Unknown");
    generateBillSignedNews(bill.title, sponsorName, "federal").catch((err) =>
      console.error("[News] Failed to generate bill signed news:", err)
    );

    return { success: true, message: `"${bill.title}" has been signed into law.` };
  } else {
    const trimmedVetoMessage = vetoMessage?.trim();
    const vetoGameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const vetoTurn = vetoGameState?.currentTurn ?? 1;
    // Atomically claim the enrolled→veto_override transition so a concurrent
    // action cannot open a second override window and re-announce the veto.
    const claimed = await claimStatusTransition(
      db,
      "bills",
      { _id: billId, status: "enrolled" },
      {
        $set: {
          status: "veto_override",
          presidentAction: "vetoed",
          vetoOverrideVotes: {},
          vetoOverrideVotesFor: 0,
          vetoOverrideVotesAgainst: 0,
          overrideVotingStartedAt: now,
          overrideVotingEndsAt: new Date(now.getTime() + OVERRIDE_WINDOW_MS),
          overrideVotingEndsOnTurn: vetoTurn + OVERRIDE_WINDOW_HOURS,
          ...(trimmedVetoMessage ? { vetoMessage: trimmedVetoMessage } : {}),
          vetoedByCharacterId: characterId,
          vetoedAtTurn: vetoTurn,
          updatedAt: now,
        },
      }
    );
    if (!claimed) {
      return {
        success: false,
        message: "",
        error: "This bill is not awaiting presidential action.",
      };
    }

    // Single choke point for a presidential veto — shared by the congress
    // bills route and the whitehouse bills action route (both call this
    // function). "bill.enact" for the eventual sign/override outcome is
    // recorded once, centrally, in `onBillEnacted` (billEnactment.ts).
    recordAudit({
      source: "api",
      action: "bill.veto",
      category: "governance",
      subject: { type: "bill", id: billId, name: bill.title },
      counterparty: bill.sponsorId
        ? { type: "character", id: bill.sponsorId, name: bill.sponsorName }
        : undefined,
      refs: { billId },
      meta: { vetoMessage: Boolean(trimmedVetoMessage) },
      outcome: "ok",
    });

    if (bill.sponsorId) {
      const sponsor = await db
        .collection<Character>("characters")
        .findOne({ _id: bill.sponsorId }, { projection: { userId: 1 } });
      if (sponsor?.userId) {
        await createNotification({
          userId: sponsor.userId,
          type: "bill_vetoed",
          title: "Bill Vetoed",
          message: `"${bill.title}" was vetoed by the President. Congress has 24 hours to attempt an override.`,
          metadata: { billId: bill._id.toString() },
        });
      }
    }
    // Notify the bill country's seated House and Senate members that override voting is open
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        officeType: { $in: ["house", "senate"] },
        countryId: bill.countryId ?? "US",
        characterId: { $ne: null },
        isNPP: { $ne: true },
      })
      .toArray();
    const charIds = officials
      .map((o) => o.characterId)
      .filter((id): id is ObjectId => id instanceof ObjectId);
    if (charIds.length > 0) {
      const chars = await db
        .collection<Character>("characters")
        .find({ _id: { $in: charIds } }, { projection: { _id: 1, userId: 1 } })
        .toArray();
      await Promise.all(
        chars.map((c) =>
          createNotification({
            userId: c.userId,
            type: "bill_vote_open",
            title: "Veto Override Vote Open",
            message: `The President vetoed "${bill.title}". Vote now to override. Requires 2/3 majority in both chambers.`,
            metadata: { billId: bill._id.toString() },
          })
        )
      ).catch((err) => console.error("[Notification] Failed to notify override vote:", err));
    }

    // Generate system news (fire-and-forget)
    generateBillVetoedNews(bill.title, "federal", undefined, bill.countryId).catch((err) =>
      console.error("[News] Failed to generate bill veto news:", err)
    );

    // Announce the veto on the bill country's game-events Discord webhook (fire-and-forget).
    const president = await db
      .collection<Character>("characters")
      .findOne({ _id: characterId }, { projection: { name: 1 } });
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";
    const billUrl = `${baseUrl}/congress/bills/${bill._id.toString()}`;
    sendCountryGameEvent(
      bill.countryId ?? "US",
      buildBillVetoedDiscordEmbed({
        billTitle: bill.title,
        presidentName: president?.name,
        vetoMessage: trimmedVetoMessage,
        billUrl,
      })
    ).catch(() => {});

    return { success: true, message: `"${bill.title}" has been vetoed.` };
  }
}
