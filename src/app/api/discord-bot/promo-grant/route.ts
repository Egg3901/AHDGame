import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, errorResponse, isDuplicateKeyError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_FINANCIAL_LIMITS } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildHomeCurrencyCashGrantSetStage } from "@/lib/currency/grantCashBuilder";
import {
  COUNTRY_CURRENCY_MAP,
  INITIAL_RATES,
  getCountryIdForCurrency,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { getPromoCampaign, type PromoCampaign } from "@/lib/promo/campaigns";
import {
  PROMO_GRANT_STALE_PENDING_MS,
  ensurePromoGrantIndexes,
  getPromoGrantsCollection,
  type PromoGrant,
} from "@/lib/promo/promoGrants";
import type { Character, ExchangeRate, User } from "@/lib/db/types";

const BOT_ADMIN_NAME = "Discord Bot";

const schema = z.object({
  campaign: z.string().min(1).max(120),
  discordId: z.string().regex(/^\d{15,22}$/, "discordId must be a Discord snowflake"),
  claimRef: z.string().min(1).max(120),
  characterId: z
    .string()
    .regex(/^[a-f0-9]{24}$/i, "characterId must be a 24-character hex id")
    .optional(),
});

interface ResolvedCredit {
  currency: CurrencyCode;
  rate: number;
  amountLocal: number;
  forexEnabled: boolean;
  rateByCountry: Map<string, number>;
}

function summary(grant: PromoGrant, status: "granted" | "already_granted") {
  return {
    status,
    campaign: grant.campaign,
    characterId: grant.characterId.toString(),
    characterName: grant.characterName,
    countryId: grant.countryId,
    currency: grant.currency,
    amountAnchor: grant.amountAnchor,
    amountLocal: grant.amountLocal,
    claimRef: grant.claimRef,
  };
}

/**
 * Same conversion as the admin `cashOnHand` grant with no explicit currency:
 * ₳ converts into the home currency at the rate of that currency's anchor
 * country, so countries sharing a currency convert identically.
 */
async function resolveCredit(
  db: Db,
  character: Character,
  amountAnchor: number
): Promise<ResolvedCredit | null> {
  const currency = COUNTRY_CURRENCY_MAP[character.countryId] as CurrencyCode | undefined;
  if (!currency) return null;
  const forexEnabled = await isForexEnabled();
  if (!forexEnabled) {
    return { currency, rate: 1, amountLocal: amountAnchor, forexEnabled, rateByCountry: new Map() };
  }
  const rateDocs = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
  const rateByCountry = new Map<string, number>(rateDocs.map((r) => [r._id as string, r.rate]));
  const anchorCountry = getCountryIdForCurrency(currency);
  const rate = rateByCountry.get(anchorCountry) ?? INITIAL_RATES[anchorCountry] ?? 1;
  return { currency, rate, amountLocal: amountAnchor * rate, forexEnabled, rateByCountry };
}

/**
 * Credit the character exactly once per grant id. The receipt list on the
 * character makes the write idempotent: a retry after a crash between the
 * credit and the status flip finds the receipt and skips the second payment.
 */
async function creditCharacter(
  db: Db,
  characterId: ObjectId,
  grantId: ObjectId,
  amountAnchor: number,
  credit: ResolvedCredit,
  isRetry: boolean
): Promise<void> {
  const receipt = grantId.toString();
  if (isRetry) {
    // A retry may target a different character than the attempt that died,
    // so look for the receipt on any character before paying again.
    const paidEarlier = await db
      .collection<Character>("characters")
      .findOne({ promoGrantReceipts: receipt }, { projection: { _id: 1 } });
    if (paidEarlier) return;
  }
  const setStage: Record<string, unknown> = credit.forexEnabled
    ? buildHomeCurrencyCashGrantSetStage(amountAnchor, credit.rateByCountry)
    : { cashOnHand: { $add: [{ $ifNull: ["$cashOnHand", 0] }, amountAnchor] } };
  setStage.promoGrantReceipts = {
    $concatArrays: [{ $ifNull: ["$promoGrantReceipts", []] }, { $literal: [receipt] }],
  };
  setStage.updatedAt = new Date();

  const result = await db
    .collection<Character>("characters")
    .updateOne({ _id: characterId, promoGrantReceipts: { $ne: receipt } }, [{ $set: setStage }]);
  if (result.matchedCount === 1) return;

  const alreadyCredited = await db
    .collection<Character>("characters")
    .findOne({ _id: characterId, promoGrantReceipts: receipt }, { projection: { _id: 1 } });
  if (!alreadyCredited) throw new Error("Promo grant target character not found");
}

async function recordGrant(
  db: Db,
  grant: PromoGrant,
  campaign: PromoCampaign,
  user: User
): Promise<void> {
  const now = new Date();
  const thresholds = await loadTxThresholds(db);
  await emitTxBulk(
    db,
    [
      {
        type: "admin_transfer",
        turn: 0,
        createdAt: now,
        subjectType: "character",
        subjectId: grant.characterId,
        subjectName: grant.characterName,
        amount: grant.amountLocal,
        anchorAmount: grant.amountAnchor,
        currencyCode: grant.currency,
        meta: {
          adminUsername: BOT_ADMIN_NAME,
          resource: "cash_on_hand",
          reason: "promotional_grant",
          campaign: grant.campaign,
          campaignLabel: campaign.label,
          claimRef: grant.claimRef,
          promoGrantId: grant._id.toString(),
        },
      },
    ],
    thresholds
  );
  await createAdminLog({
    category: "system",
    action: "resources_granted",
    username: user.username,
    characterName: grant.characterName,
    adminUsername: BOT_ADMIN_NAME,
    details: `Promotional grant "${grant.campaign}" (${campaign.label}): +₳${grant.amountAnchor.toLocaleString()} cash on hand (auto-converted to ${grant.amountLocal.toLocaleString()} ${grant.currency})`,
  });
}

// POST /api/discord-bot/promo-grant: credit a server-defined promotional cash
// grant to a Discord-linked player, at most once per player per campaign.
// Body: { campaign, discordId, claimRef, characterId? }
// Auth: requireBotToken (private key only)
// Errors: 400, 401, 404, 409, 422, 429, 500
export async function POST(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return errorResponse(401, "Unauthorized");
    }

    const rateLimit = checkRateLimit(
      "discord-bot:promo-grant",
      BOT_FINANCIAL_LIMITS.maxRequests,
      BOT_FINANCIAL_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { campaign: campaignId, discordId, claimRef, characterId } = parsed.data;

    const campaign = getPromoCampaign(campaignId);
    if (!campaign) return errorResponse(400, "Unknown campaign");

    const db = await getDb();

    const user = await db.collection<User>("users").findOne({ discordId });
    if (!user || user.isBanned) return errorResponse(404, "No linked account");

    const character = characterId
      ? await db
          .collection<Character>("characters")
          .findOne({ _id: new ObjectId(characterId), userId: user._id })
      : await db.collection<Character>("characters").findOne({ userId: user._id });
    if (!character) return errorResponse(404, "No active character");

    const credit = await resolveCredit(db, character, campaign.amountAnchor);
    if (!credit) return errorResponse(422, "Character has no home currency");

    await ensurePromoGrantIndexes(db);
    const grants = getPromoGrantsCollection(db);
    const now = new Date();
    const attemptFields = {
      characterId: character._id,
      characterName: character.name,
      countryId: character.countryId,
      currency: credit.currency,
      rate: credit.rate,
      amountLocal: credit.amountLocal,
      attemptStartedAt: now,
    };

    let grant: PromoGrant;
    const fresh: PromoGrant = {
      _id: new ObjectId(),
      campaign: campaignId,
      userId: user._id,
      discordId,
      claimRef,
      amountAnchor: campaign.amountAnchor,
      status: "pending",
      createdAt: now,
      attempts: 1,
      grantedAt: null,
      ...attemptFields,
    };
    try {
      await grants.insertOne(fresh);
      grant = fresh;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = await grants.findOne({
        campaign: campaignId,
        $or: [{ userId: user._id }, { discordId }],
      });
      if (!existing) throw error;
      if (existing.status === "granted") {
        return NextResponse.json(summary(existing, "already_granted"));
      }
      if (!existing.userId.equals(user._id)) {
        // The Discord account was relinked after an unfinished claim by a
        // different game account. Do not move the claim across accounts.
        return errorResponse(409, "Claim belongs to another account");
      }
      // Re-attempt a failed or abandoned claim. The status filter makes the
      // flip atomic, so of two concurrent retries only one wins the claim.
      const staleCutoff = new Date(now.getTime() - PROMO_GRANT_STALE_PENDING_MS);
      const reclaimed = await grants.findOneAndUpdate(
        {
          _id: existing._id,
          $or: [
            { status: "failed" },
            { status: "pending", attemptStartedAt: { $lt: staleCutoff } },
          ],
        },
        {
          $set: { ...attemptFields, status: "pending" },
          $inc: { attempts: 1 },
          $unset: { error: "", failedAt: "" },
        },
        { returnDocument: "after" }
      );
      if (!reclaimed) {
        // Another request is mid-credit for this claim; it will finish it.
        return NextResponse.json(summary(existing, "already_granted"));
      }
      grant = reclaimed;
    }

    try {
      await creditCharacter(
        db,
        grant.characterId,
        grant._id,
        grant.amountAnchor,
        credit,
        grant.attempts > 1
      );
    } catch (error) {
      await grants.updateOne(
        { _id: grant._id, status: "pending" },
        {
          $set: {
            status: "failed",
            failedAt: new Date(),
            error: error instanceof Error ? error.message : String(error),
          },
        }
      );
      throw error;
    }

    const grantedAt = new Date();
    await grants.updateOne({ _id: grant._id }, { $set: { status: "granted", grantedAt } });
    grant = { ...grant, status: "granted", grantedAt };

    await recordGrant(db, grant, campaign, user);

    return NextResponse.json(summary(grant, "granted"));
  } catch (error) {
    return handleRouteError(error);
  }
}
