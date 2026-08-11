/**
 * NPP found-a-corporation command core (V3 full-agency finance).
 *
 * Lets an ambitious, sufficiently wealthy NPP found a brand-new corporation
 * — the natural next step after nppBuyShares/nppSellShares let NPPs
 * accumulate capital in the equity market. Reuses `spawnNppCorporation` (the
 * same auth-independent core the production admin batch-spawn tool and the
 * sim harness bootstrap both already use) for everything correctness-
 * critical — ticker generation, sector creation, unowned-market-derived
 * starting revenue, national-corp exclusion, share allocation math — rather
 * than reimplementing any of it.
 *
 * The one thing `spawnNppCorporation` can't do is guarantee a SPECIFIC NPP
 * becomes CEO (its own CEO selection, `chooseNppCorpCeo`, balances
 * ownership across a country's parties and is deliberately not overridable
 * to a single NPP — that balancing logic is shared with production admin
 * tooling and shouldn't be touched for this). So: spawn normally (biased
 * toward the founder's own party via `nppPartyId`), then reassign — move
 * the auto-selected CEO's majority stake to the founding NPP via the same
 * atomic share ops nppBuyShares/nppSellShares use, and flip `ceoId`. If the
 * auto-selected CEO IS already the founder (can happen — same balancing
 * pool), the reassignment is a no-op.
 *
 * Scope constraint: founding a corporation is a REAL-ECONOMY action, so the
 * founding fee is deducted from the founder's personal forex account
 * (`nppInvestmentCashAnchor`, ₳), NOT the campaign war chest (`funds`). The
 * fee is quoted LOCAL and converted at the FX boundary. The corp's own
 * starting treasury is a separate, system-granted amount from
 * spawnNppCorporation's default, unrelated to the founder's personal cost of
 * entry. Deducted BEFORE spawning (atomic guard) so a corp is never created
 * for an NPP who then turns out unable to pay.
 */

import { ObjectId, type Db } from "mongodb";
import type { Corporation, NPP } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import { generateNppCorpName, spawnNppCorporation } from "@/lib/admin/spawnNppCorporation";
import { nppHomeFxRate, localToAnchor } from "./nppEconomicAccount";

export type NppFoundCorporationResult =
  | {
      ok: true;
      corporationId: string;
      name: string;
      type: CorporationType;
      foundingFee: number;
      foundingFeeAnchor: number;
      investmentCashAnchor: number;
    }
  | { ok: false; reason: string };

export async function nppFoundCorporation(
  db: Db,
  npp: Pick<NPP, "_id" | "countryId" | "party" | "homeState" | "personality">,
  sectorType: CorporationType,
  foundingFeeLocal: number,
  currentTurn: number,
  /** Pre-loaded home FX rate (local per ₳); loaded on demand when omitted. */
  homeRate?: number
): Promise<NppFoundCorporationResult> {
  if (!npp.homeState) {
    return { ok: false, reason: "NPP has no home state to headquarter a corporation in." };
  }
  const countryId = npp.countryId ?? "US";

  const alreadyCeo = await db
    .collection<Corporation>("corporations")
    .findOne({ ceoId: npp._id, ceoVacant: { $ne: true } });
  if (alreadyCeo) {
    return { ok: false, reason: "NPP already runs a corporation." };
  }

  // Founding is real-economy → charge the personal forex account, not campaign
  // `funds`. Fee is quoted LOCAL; convert at the FX boundary.
  const rate = homeRate ?? (await nppHomeFxRate(db, npp.countryId));
  const foundingFeeAnchor = localToAnchor(foundingFeeLocal, rate);
  const now = new Date();
  const deducted = await db
    .collection<NPP>("npps")
    .findOneAndUpdate(
      { _id: npp._id, nppInvestmentCashAnchor: { $gte: foundingFeeAnchor } },
      { $inc: { nppInvestmentCashAnchor: -foundingFeeAnchor }, $set: { updatedAt: now } },
      { returnDocument: "after" }
    );
  if (!deducted) {
    return { ok: false, reason: "Insufficient investment capital to found a corporation." };
  }

  const name = generateNppCorpName(countryId, sectorType, []);
  let spawnResult;
  try {
    spawnResult = await spawnNppCorporation(db, {
      name,
      type: sectorType,
      countryId,
      headquartersState: npp.homeState,
      nppPartyId: npp.party,
      foundedAtTurn: currentTurn,
    });
  } catch (error) {
    // Refund the founding fee — no corp was created, no partial state.
    await db
      .collection<NPP>("npps")
      .updateOne(
        { _id: npp._id },
        { $inc: { nppInvestmentCashAnchor: foundingFeeAnchor }, $set: { updatedAt: new Date() } }
      );
    return {
      ok: false,
      reason: `Corporation founding failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const corporationId = new ObjectId(spawnResult.corporationId);
  const autoCeoId = new ObjectId(spawnResult.nppId);

  // Reassign CEO + the auto-selected CEO's stake to the founding NPP, unless
  // the balancer already happened to pick the founder. This renames the
  // existing shareholder entry's holder in place — NOT a debit+credit trade
  // — because the initial CEO stake is a grant with no cost basis
  // (spawnNppCorporation never sets avgCostPerShare on it), and a rename
  // preserves that instead of forcing a price through the trade-basis math
  // creditSharesToNpp/debitSharesFromNpp are built for.
  if (!autoCeoId.equals(npp._id)) {
    await db.collection<Corporation>("corporations").updateOne(
      { _id: corporationId, "shareholders.nppId": autoCeoId },
      {
        $set: {
          "shareholders.$.nppId": npp._id,
          ceoId: npp._id,
          updatedAt: new Date(),
        },
      }
    );
  }

  return {
    ok: true,
    corporationId: spawnResult.corporationId,
    name: spawnResult.name,
    type: sectorType,
    foundingFee: foundingFeeLocal,
    foundingFeeAnchor,
    investmentCashAnchor: deducted.nppInvestmentCashAnchor ?? 0,
  };
}
