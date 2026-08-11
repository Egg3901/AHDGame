import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { optimizeImage, IMAGE_PRESETS } from "@/lib/imageOptimize";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getPersonalBalance, getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
} from "@/lib/financialTxLog/atomicCashGuard";
import { getPlayerBannerAdsCollection } from "@/lib/db/collections/playerBannerAds";
import type { Character, User } from "@/lib/db/types";
import { isPlusOrBetter } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { isR2Enabled, uploadFile } from "@/lib/r2";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { parseFormData } from "@/lib/api/validate";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

// Rate limits by tier: window length (in game turns) and max free ads allowed.
// Turn-denominated so the cooldown stays fixed in game-time regardless of cron
// cadence / fastMode (a turn is normally 1h but 30m in fastMode). Window sizes
// preserve the original wall-clock intent: 1 turn == 1h when authored.
const RATE_LIMITS = {
  none: { windowTurns: 24, maxFree: 0 }, // 24 turns, no free ads
  supporter: { windowTurns: 72, maxFree: 1 }, // 72 turns, 1 free
  supporterPlus: { windowTurns: 48, maxFree: 2 }, // 48 turns, 2 free
};

const WEALTH_PERCENTAGE = 0.02; // 2% of average wealth

async function computeAverageCost(db: Db, forexEnabled: boolean): Promise<number> {
  if (forexEnabled) {
    const chars = await db
      .collection<Character>("characters")
      .find({}, { projection: { countryId: 1, currencyBalances: 1, cashOnHand: 1 } })
      .toArray();

    let total = 0;
    let count = 0;
    for (const char of chars) {
      const home = getHomeCurrency(char) as CurrencyCode;
      const bal = getPersonalBalance(char, home, true);
      if (bal > 0) {
        total += bal;
        count++;
      }
    }
    return count > 0 ? Math.floor((total / count) * WEALTH_PERCENTAGE) : 0;
  }

  const result = await db
    .collection<Character>("characters")
    .aggregate<{ avg: number }>([
      { $match: { cashOnHand: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: "$cashOnHand" } } },
    ])
    .toArray();
  return result[0] ? Math.floor(result[0].avg * WEALTH_PERCENTAGE) : 0;
}

// GET /api/player-ads — returns cost info and rate-limit state for the upload form.
export async function GET() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;

    const db = await getDb();
    const forexEnabled = await isForexEnabled();
    const cost = await computeAverageCost(db, forexEnabled);
    const homeCurrency = getHomeCurrency(character) as CurrencyCode;
    const balance = getPersonalBalance(character, homeCurrency, forexEnabled);

    const dbUser = await db
      .collection<User>("users")
      .findOne(
        { _id: new ObjectId(auth.user.userId) },
        { projection: { patreonTier: 1, patreonExpiresAt: 1 } }
      );
    const patreonTier = dbUser?.patreonTier ?? null;
    const patreonExpiresAt = dbUser?.patreonExpiresAt ?? null;

    // Determine Patreon tier and rate limits
    const isPatronActive =
      patreonTier !== null && (!patreonExpiresAt || patreonExpiresAt > new Date());
    const rateLimit = isPatronActive
      ? isPlusOrBetter(patreonTier)
        ? RATE_LIMITS.supporterPlus
        : RATE_LIMITS.supporter
      : RATE_LIMITS.none;

    // Check rate limit — find ads by this character within the turn window
    const ads = await getPlayerBannerAdsCollection(db);
    const currentTurn = await getCurrentTurn(db);
    const windowStartTurn = currentTurn - rateLimit.windowTurns;
    const recentAds = await ads
      .find({ characterId: character._id, createdTurn: { $gte: windowStartTurn } })
      .sort({ createdTurn: -1 })
      .toArray();

    const freeUsed = recentAds.filter((ad) => ad.costPaid === 0).length;
    const canUseFree = freeUsed < rateLimit.maxFree;
    const turnsUntilEligible =
      recentAds.length > 0 && !canUseFree
        ? Math.max(0, recentAds[0].createdTurn + rateLimit.windowTurns - currentTurn)
        : null;

    return NextResponse.json({
      cost,
      currencyCode: homeCurrency,
      balance,
      affordable: balance >= cost,
      // Gate on the turn window too: POST hard-blocks a within-window resubmit
      // with 429, so the button must not look clickable while rate-limited.
      canSubmit: (canUseFree || balance >= cost) && turnsUntilEligible === null,
      isFree: canUseFree,
      freeUsed,
      freeLimit: rateLimit.maxFree,
      turnsUntilEligible,
      tier: patreonTier,
      isPatronActive,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/player-ads — submit a new player banner ad. Accepts multipart/form-data.
// Fields: file (required), linkUrl (optional), altText (optional)
export async function POST(request: Request) {
  let turnsUntilEligible: number | null = null;
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;
    const { character } = authUser;

    const db = await getDb();
    const forexEnabled = await isForexEnabled();
    const homeCurrency = getHomeCurrency(character) as CurrencyCode;
    const ads = await getPlayerBannerAdsCollection(db);

    const dbUser = await db
      .collection<User>("users")
      .findOne(
        { _id: new ObjectId(authUser.userId) },
        { projection: { patreonTier: 1, patreonExpiresAt: 1 } }
      );
    const patreonTier = dbUser?.patreonTier ?? null;
    const patreonExpiresAt = dbUser?.patreonExpiresAt ?? null;

    // Determine Patreon tier and rate limits
    const isPatronActive =
      patreonTier !== null && (!patreonExpiresAt || patreonExpiresAt > new Date());
    const rateLimit = isPatronActive
      ? isPlusOrBetter(patreonTier)
        ? RATE_LIMITS.supporterPlus
        : RATE_LIMITS.supporter
      : RATE_LIMITS.none;

    const currentTurn = await getCurrentTurn(db);
    const windowStartTurn = currentTurn - rateLimit.windowTurns;
    const recentAds = await ads
      .find({ characterId: character._id, createdTurn: { $gte: windowStartTurn } })
      .sort({ createdTurn: -1 })
      .toArray();

    const freeUsed = recentAds.filter((ad) => ad.costPaid === 0).length;
    const canUseFree = freeUsed < rateLimit.maxFree;

    if (!canUseFree && recentAds.length > 0) {
      const turnsLeft = Math.max(0, recentAds[0].createdTurn + rateLimit.windowTurns - currentTurn);
      return NextResponse.json(
        { error: "You have used your ad slots for this period.", turnsUntilEligible: turnsLeft },
        { status: 429 }
      );
    }

    const cost = await computeAverageCost(db, forexEnabled);
    const balance = getPersonalBalance(character, homeCurrency, forexEnabled);
    const isFree = canUseFree;
    if (!isFree && balance < cost) {
      return NextResponse.json(
        { error: "Insufficient balance to purchase this ad." },
        { status: 402 }
      );
    }

    // Parse multipart form
    const parsed = await parseFormData(request);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const formData = parsed.data;
    const file = formData.get("file");
    const linkUrl = (formData.get("linkUrl") as string | null)?.trim() || undefined;
    const altText = (formData.get("altText") as string | null)?.trim() || undefined;

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No image file uploaded." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, WebP, and GIF images are allowed." },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Image must be under 2 MB." }, { status: 400 });
    }

    // Validate optional URL
    if (linkUrl) {
      try {
        const url = new URL(linkUrl);
        if (url.protocol !== "https:") {
          return NextResponse.json({ error: "Link URL must use HTTPS." }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: "Invalid link URL." }, { status: 400 });
      }
    }

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const { buffer: optimized, ext } = await optimizeImage(
      rawBuffer,
      file.type,
      IMAGE_PRESETS.bannerAd
    );

    const timestamp = Date.now();
    let imageUrl: string;

    if (isR2Enabled()) {
      imageUrl = await uploadFile(
        `player-banner-ads/${character._id.toString()}-${timestamp}.${ext}`,
        optimized
      );
    } else {
      const fs = await import("fs/promises");
      const path = await import("path");
      const dir = path.join(process.cwd(), "uploads", "player-banner-ads");
      await fs.mkdir(dir, { recursive: true });
      const filename = `${character._id.toString()}-${timestamp}.${ext}`;
      await fs.writeFile(path.join(dir, filename), optimized);
      imageUrl = `/api/uploads/player-banner-ads/${filename}`;
    }

    const personalBalanceField = forexEnabled
      ? `currencyBalances.personal.${homeCurrency}`
      : "cashOnHand";
    const ad = await runWithOptionalTransaction(
      async (session) => {
        const recentAdsInTx = await ads
          .find({ characterId: character._id, createdTurn: { $gte: windowStartTurn } }, { session })
          .sort({ createdTurn: -1 })
          .toArray();
        const freeUsedInTx = recentAdsInTx.filter((entry) => entry.costPaid === 0).length;
        const canUseFreeInTx = freeUsedInTx < rateLimit.maxFree;

        if (!canUseFreeInTx && recentAdsInTx.length > 0) {
          turnsUntilEligible = Math.max(
            0,
            recentAdsInTx[0].createdTurn + rateLimit.windowTurns - currentTurn
          );
          throw new Error("PLAYER_AD_SLOT_UNAVAILABLE");
        }

        if (!canUseFreeInTx) {
          const debitResult = await db
            .collection<Character>("characters")
            .updateOne(
              { _id: character._id, [personalBalanceField]: { $gte: cost } },
              { $inc: { [personalBalanceField]: -cost }, $set: { updatedAt: new Date() } },
              { session }
            );

          if (debitResult.modifiedCount === 0) {
            throw new Error("PLAYER_AD_FUNDS_CHANGED");
          }
        }

        return ads.insertOne(
          {
            _id: new ObjectId(),
            characterId: character._id,
            userId: new ObjectId(authUser.userId),
            characterName: character.name,
            countryId: character.countryId,
            imageUrl,
            linkUrl,
            altText,
            viewCount: 0,
            isActive: true,
            moderationStatus: "pending" as const,
            createdAt: new Date(),
            createdTurn: currentTurn,
            costPaid: canUseFreeInTx ? 0 : cost,
            currencyCode: homeCurrency,
          },
          { session }
        );
      },
      async () => {
        const recentAdsFallback = await ads
          .find({ characterId: character._id, createdTurn: { $gte: windowStartTurn } })
          .sort({ createdTurn: -1 })
          .toArray();
        const freeUsedFallback = recentAdsFallback.filter((entry) => entry.costPaid === 0).length;
        const canUseFreeFallback = freeUsedFallback < rateLimit.maxFree;

        if (!canUseFreeFallback && recentAdsFallback.length > 0) {
          turnsUntilEligible = Math.max(
            0,
            recentAdsFallback[0].createdTurn + rateLimit.windowTurns - currentTurn
          );
          throw new Error("PLAYER_AD_SLOT_UNAVAILABLE");
        }

        let debited = false;
        if (!canUseFreeFallback) {
          const debitResult = await atomicallyDebitCharacterCash(
            db,
            character._id,
            homeCurrency,
            cost,
            forexEnabled
          );
          if (!debitResult.ok) {
            throw new Error("PLAYER_AD_FUNDS_CHANGED");
          }
          debited = true;
        }

        try {
          return await ads.insertOne({
            _id: new ObjectId(),
            characterId: character._id,
            userId: new ObjectId(authUser.userId),
            characterName: character.name,
            countryId: character.countryId,
            imageUrl,
            linkUrl,
            altText,
            viewCount: 0,
            isActive: true,
            moderationStatus: "pending" as const,
            createdAt: new Date(),
            createdTurn: currentTurn,
            costPaid: canUseFreeFallback ? 0 : cost,
            currencyCode: homeCurrency,
          });
        } catch (error) {
          if (debited) {
            await refundCharacterCash(db, character._id, homeCurrency, cost, forexEnabled);
          }
          throw error;
        }
      }
    );

    return NextResponse.json({ success: true, adId: ad.insertedId.toString() }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "PLAYER_AD_SLOT_UNAVAILABLE") {
      return NextResponse.json(
        { error: "You have used your ad slots for this period.", turnsUntilEligible },
        { status: 429 }
      );
    }
    if (error instanceof Error && error.message === "PLAYER_AD_FUNDS_CHANGED") {
      return NextResponse.json(
        { error: "Your available personal funds changed before the ad completed." },
        { status: 409 }
      );
    }
    return handleRouteError(error);
  }
}
