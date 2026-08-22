import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { computeIpoIssuance } from "../../ipoIssuance";
import { IPO_COOLDOWN_TURNS } from "@/lib/constants/corporations";
import { hasSuperShares, isValidSuperShareMultiplier } from "../../superShares";
import { recordAudit } from "@/lib/audit/recordAudit";

/**
 * True when the corp has any non-CEO character or corporation shareholder
 * holding shares. Used to block a late IPO that would dilute minority holders
 * who never consented (they bought/received shares while the corp was private).
 */
function hasNonCeoShareholders(corp: Corporation): boolean {
  const ceoIdStr = corp.ceoId.toString();
  return corp.shareholders.some(
    (s) =>
      s.shares > 0 &&
      s.characterId?.toString() !== ceoIdStr &&
      // Corporation holders are also "non-CEO."
      (s.corporationId !== undefined || s.characterId !== undefined)
  );
}

export interface GoPublicInput {
  db: Db;
  corporation: Corporation;
  floatPct: number;
  currentTurn: number;
  /**
   * Dual-class IPO: the founder's pre-IPO shares become supershares carrying
   * this many votes each, and the float cap rises to SUPERSHARE_IPO_MAX_FLOAT_PCT.
   */
  superShareMultiplier?: number;
}

export type GoPublicResult =
  | { ok: false; error: string; status: number }
  | { ok: true; newShares: number; proceeds: number; totalSharesAfter: number };

/**
 * Convert a private corp to public by issuing new shares to the public float at
 * the current sharePrice. Cash flows into the corporation's treasury.
 *
 * Cooldown anchor: `lastPrivatizationTurn` only. The cooldown exists to prevent
 * rapid public↔private oscillation; a corp that has never been public (founded
 * private, never went private after IPO) has nothing to oscillate, so founding
 * turn is not an anchor — going public immediately after founding private is
 * equivalent to founding as a public IPO.
 */
export async function goPublic(input: GoPublicInput): Promise<GoPublicResult> {
  const { db, corporation, floatPct, currentTurn, superShareMultiplier } = input;

  if (!corporation.isPrivate) {
    return { ok: false, error: "Corporation is already public", status: 400 };
  }

  if (superShareMultiplier !== undefined) {
    if (!isValidSuperShareMultiplier(superShareMultiplier)) {
      return { ok: false, error: "Invalid supershare vote multiplier", status: 400 };
    }
    if (hasSuperShares(corporation)) {
      return {
        ok: false,
        error: "Corporation already has a dual-class supershare structure",
        status: 400,
      };
    }
    if ((corporation.ceoType ?? "character") !== "character") {
      return {
        ok: false,
        error: "Only corporations with a player character CEO can adopt supershares",
        status: 400,
      };
    }
  }

  // Refuse if the private corp has minority holders. The IPO would dilute them
  // without consent — they took their position when the corp was private and
  // the spec assumes private corps are 100% CEO-owned. CEO must buy them out
  // (or otherwise consolidate) before going public.
  if (hasNonCeoShareholders(corporation)) {
    return {
      ok: false,
      error:
        "This corporation has minority shareholders. Buy them out before going public — IPO without consent would dilute them.",
      status: 400,
    };
  }

  if (corporation.lastPrivatizationTurn !== undefined) {
    const turnsSincePrivatization = currentTurn - corporation.lastPrivatizationTurn;
    if (turnsSincePrivatization < IPO_COOLDOWN_TURNS) {
      return {
        ok: false,
        error: `IPO cooldown active — wait ${IPO_COOLDOWN_TURNS - turnsSincePrivatization} more turns`,
        status: 400,
      };
    }
  }

  let ipo;
  try {
    ipo = computeIpoIssuance({
      existingShares: corporation.totalShares,
      pricePerShare: corporation.sharePrice,
      floatPct,
      withSuperShares: superShareMultiplier !== undefined,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid IPO terms", status: 400 };
  }
  const proceeds = Math.round(ipo.proceeds);

  const updateRes = await db.collection<Corporation>("corporations").updateOne(
    { _id: corporation._id, isPrivate: true },
    {
      $set: {
        isPrivate: false,
        // Auction-created shells are hidden until they have an owner. A later
        // IPO must clear that flag or the now-public corporation stays absent
        // from every exchange snapshot indefinitely.
        hiddenFromExchange: false,
        lastIpoTurn: currentTurn,
        updatedAt: new Date(),
      },
      // Issuance only creates float inventory; it does NOT credit cash. The corp
      // realizes proceeds as the float is actually bought (treasury-backed market
      // maker in the share-buy paths). Pre-fix this $inc'd liquidCapital here AND
      // the buy path credited again — double-paying the issuer (Bug #0624).
      $inc: {
        totalShares: ipo.newShares,
        publicFloat: ipo.newShares,
      },
    }
  );

  if (updateRes.matchedCount === 0) {
    return { ok: false, error: "Corporation state changed; retry", status: 409 };
  }

  if (superShareMultiplier !== undefined) {
    // Dual-class IPO: stamp the multiplier and designate the founder's pre-IPO
    // shares (their entire entry — the corp was 100% CEO-owned) as supershares.
    // The $exists guard keeps this idempotent against a concurrent adoption.
    await db
      .collection<Corporation>("corporations")
      .updateOne({ _id: corporation._id, superShareMultiplier: { $exists: false } }, [
        {
          $set: {
            superShareMultiplier,
            superSharesAdoptedAtTurn: currentTurn,
            updatedAt: new Date(),
            shareholders: {
              $map: {
                input: { $ifNull: ["$shareholders", []] },
                in: {
                  $cond: [
                    { $eq: ["$$this.characterId", corporation.ceoId] },
                    { $mergeObjects: ["$$this", { superShares: "$$this.shares" }] },
                    "$$this",
                  ],
                },
              },
            },
          },
        },
      ]);
  }

  recordAudit({
    source: "api",
    action: "corp.goPublic",
    category: "corp",
    turn: currentTurn,
    subject: { type: "corporation", id: corporation._id, name: corporation.name },
    amount: proceeds,
    refs: { corporationId: corporation._id },
    outcome: "ok",
    meta: { floatPct, newShares: ipo.newShares, superShareMultiplier },
  });

  return {
    ok: true,
    newShares: ipo.newShares,
    proceeds,
    totalSharesAfter: ipo.totalSharesAfter,
  };
}
