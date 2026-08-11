import type { Db, ObjectId } from "mongodb";
import { ObjectId as Oid } from "mongodb";
import type { Character, Corporation, CorporateSector } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import { CEO_INITIAL_SHARES, DEFAULT_SHARE_PRICE } from "@/lib/constants/corporations";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { getEraFounderShares } from "@/lib/constants/sectorSeedEra";
import { generateTickerSymbol } from "@/lib/corporations/tickerSymbol";
import { openCeoTenure } from "@/lib/corporations/ceoHistory";
import { getDefaultLegalStructureId } from "@/lib/corporations/legalStructure";
import {
  anchorToCorpLiquidCapital,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import {
  atomicallyDebitCorpLiquidCapital,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import { emitTx } from "@/lib/financialTxLog/emit";
import { isEligibleAsSubsidiaryParent, humanBlockedFromSubsidiaryCeo } from "../helpers";
import { collectSiblingSubsidiaryCeoUserIds, resolveParentCeoUserId } from "../parentContext";
import { pickOrCreateNppCeoForNewCorp } from "../nppCeoSelection";
import { SPIN_OFF_COOLDOWN_TURNS, spinOffCostAnchor } from "../constants";
import { fail, type SubsidiaryCommandResult } from "../commandTypes";

// PLANTS-GATED: a spin-off only re-points `corporationId` on the existing row, so
// capitalStock, buildQueue, CIP and plantsStartTurn ride along untouched. There
// is no plant state to fold and nothing for plants to erase.
export interface SpinOffInput {
  parent: Corporation;
  callerUserId: ObjectId;
  sectorType: CorporationType;
  name: string;
  tickerSymbol?: string;
  appointedCeoType: "character" | "npp";
  appointedCeoCharacterId?: ObjectId;
  forcedNppId?: string;
  turn: number;
  now: Date;
}

/**
 * Spin off one of a parent's sector types into a NEW, wholly parent-owned
 * PRIVATE corporation (no public float at creation — going public later uses the
 * existing IPO flow). The new corp is immediately a formalized subsidiary.
 */
export async function spinOff(
  db: Db,
  input: SpinOffInput
): Promise<SubsidiaryCommandResult<{ newCorporationId: string }>> {
  const {
    parent,
    callerUserId,
    sectorType,
    name,
    tickerSymbol,
    appointedCeoType,
    appointedCeoCharacterId,
    forcedNppId,
    turn,
    now,
  } = input;

  // Authorize: caller is parent CEO.
  if (parent.ceoVacant === true || !parent.userId || !parent.userId.equals(callerUserId)) {
    return fail("You must be the CEO of the parent corporation.", 403);
  }
  // Parent eligible (not national, not itself a subsidiary — no chaining).
  if (!isEligibleAsSubsidiaryParent(parent)) {
    return fail(
      "This corporation cannot spin off a subsidiary (national corporations and existing subsidiaries are excluded).",
      403
    );
  }
  // Cooldown.
  if (parent.lastSpinOffTurn != null && turn - parent.lastSpinOffTurn < SPIN_OFF_COOLDOWN_TURNS) {
    const remaining = SPIN_OFF_COOLDOWN_TURNS - (turn - parent.lastSpinOffTurn);
    return fail(`Spin-off is on cooldown for ${remaining} more turn(s).`);
  }

  const nameTrimmed = name.trim();
  if (!nameTrimmed) return fail("A corporation name is required.");

  // Parent must have ≥1 sector of the requested type.
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ corporationId: parent._id, sectorType })
    .toArray();
  if (sectors.length === 0) {
    return fail("The parent does not operate any sector of that type.");
  }

  // Resolve the CEO identity up front (before any writes).
  let ceoId: ObjectId;
  let ceoUserId: ObjectId; // system placeholder for NPP-run corps
  let ceoTypeResolved: "character" | "npp";
  const SYSTEM_USER = new Oid("000000000000000000000000");
  if (appointedCeoType === "character") {
    if (!appointedCeoCharacterId) return fail("A character is required to appoint a human CEO.");
    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: appointedCeoCharacterId }, { projection: { userId: 1 } });
    if (!character || !character.userId) {
      return fail("The selected character cannot serve as CEO (no owning player).");
    }
    // One-person rule (keys on the human behind the seat).
    const parentCeoUserId = await resolveParentCeoUserId(db, parent);
    const siblingCeoUserIds = await collectSiblingSubsidiaryCeoUserIds(db, parent._id, new Oid());
    if (
      humanBlockedFromSubsidiaryCeo({
        candidateUserId: character.userId,
        parentOwnerUserId: parent.userId,
        parentCeoUserId,
        siblingSubsidiaryCeoUserIds: siblingCeoUserIds,
      })
    ) {
      return fail("A subsidiary must be run by a different player than the parent.", 403);
    }
    ceoId = appointedCeoCharacterId;
    ceoUserId = character.userId;
    ceoTypeResolved = "character";
  } else {
    ceoId = await pickOrCreateNppCeoForNewCorp(
      db,
      parent.countryId,
      parent.headquartersState,
      forcedNppId
    );
    ceoUserId = SYSTEM_USER; // fully-NPP-run corp — system placeholder, NOT parent
    ceoTypeResolved = "npp";
  }

  // Cost: base spin-off cost + per-sector transfer fee (₳), converted to the
  // parent's local currency. Scales with the number of sectors being moved.
  const parentFx = await getCorpFxRate(db, parent);
  const costLocal = Math.round(
    anchorToCorpLiquidCapital(spinOffCostAnchor(sectors.length), parent, parentFx)
  );
  const debit = await atomicallyDebitCorpLiquidCapital(db, parent._id, costLocal);
  if (!debit.ok) {
    return fail(
      `Insufficient parent corporate funds. Spin-off costs ${costLocal.toLocaleString()} ${
        resolveCorpLiquidCurrencyCode(parent) ?? "USD"
      }.`
    );
  }

  const newCorpId = new Oid();
  const currencyCode =
    parent.liquidCurrencyCode ??
    (COUNTRY_CURRENCY_MAP[parent.countryId] as CurrencyCode | undefined);
  const parentCurrency = resolveCorpLiquidCurrencyCode(parent);

  const transferredSectorIds: ObjectId[] = [];
  const subsidiaryShares = getEraFounderShares(
    CEO_INITIAL_SHARES,
    await getGameStatePresetOrDefault(db)
  );
  try {
    // Create the wholly parent-owned private corp. Parent holds 100% of shares.
    const corpDoc: Omit<Corporation, "_id"> & { _id: ObjectId } = {
      _id: newCorpId,
      name: nameTrimmed,
      tickerSymbol: tickerSymbol?.trim() || (await generateTickerSymbol(db, nameTrimmed)),
      type: sectorType,
      ceoId,
      ceoType: ceoTypeResolved,
      ceoVacant: false,
      userId: ceoUserId,
      countryId: parent.countryId,
      headquartersState: parent.headquartersState,
      liquidCapital: 0,
      liquidCurrencyCode: currencyCode,
      marketingBudget: 0,
      marketingStrength: 0,
      logisticsBudget: 0,
      logisticsStrength: 0,
      rdBudget: 0,
      rdScore: 0,
      ceoSalary: 0,
      sequentialId: await getNextSequentialId(db, "corporation"),
      // Era share base: a fixed 10M shares at the flat DEFAULT_SHARE_PRICE
      // would open a 1953 subsidiary at a modern-sized market cap (~70x its
      // era). Deflating the base keeps the opening cap era-correct.
      totalShares: subsidiaryShares,
      sharePrice: DEFAULT_SHARE_PRICE,
      shareholders: [{ corporationId: parent._id, shares: subsidiaryShares }],
      publicFloat: 0,
      dividendRate: 0,
      suspended: false,
      hiddenFromExchange: false,
      isPrivate: true,
      legalStructure: getDefaultLegalStructureId(parent.countryId, { isPrivate: true }),
      isSpinOff: true,
      spunOffFromCorpId: parent._id,
      subsidiaryFormalizedAtTurn: turn,
      foundedAtTurn: turn,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection<Corporation>("corporations").insertOne(corpDoc as Corporation);
    await openCeoTenure(db, newCorpId, { holderId: ceoId, ceoType: ceoTypeResolved, turn });

    // Transfer the parent's sectors of this type to the new corp, re-denominating
    // revenue/currentGrowthCost across corp currencies (identity when the two
    // share a currency, which is the norm for a spun-off corp).
    //
    // PLANT STATE (P3b): this is a REASSIGN, not a merge — the sector doc keeps
    // its `_id` and only changes `corporationId`, so `capitalStock`,
    // `buildQueue`, `constructionInProgressAnchor`, `mothballed` and
    // `plantsStartTurn` ride along untouched. That is the correct outcome and
    // it must stay that way: the ₳-anchored capex fields (CIP, and each build
    // order's `costPaidAnchor`) must NOT be put through the
    // readCorpEconomicAnchor/writeCorpEconomicLocal round-trip applied to
    // revenue below. Those two fields are already ₳ by contract; re-denominating
    // them on a cross-currency spin-out would restate the same money by the FX
    // rate (~87× on a JPY parent) and let the subsidiary cancel its inherited
    // build orders for a refund far larger than the parent ever paid.
    const newFx = parentFx; // same country/currency as parent
    for (const sector of sectors) {
      const revenueAnchor = readCorpEconomicAnchor(sector.revenue, parentCurrency, parentFx);
      const growthAnchor = readCorpEconomicAnchor(
        sector.currentGrowthCost ?? 0,
        parentCurrency,
        parentFx
      );
      const newRevenueLocal = Math.round(
        writeCorpEconomicLocal(revenueAnchor, currencyCode, newFx)
      );
      const newGrowthLocal = Math.round(writeCorpEconomicLocal(growthAnchor, currencyCode, newFx));
      await db.collection<CorporateSector>("corporateSectors").updateOne(
        { _id: sector._id, corporationId: parent._id },
        {
          $set: {
            corporationId: newCorpId,
            revenue: newRevenueLocal,
            currentGrowthCost: newGrowthLocal,
            updatedAt: now,
          },
        }
      );
      transferredSectorIds.push(sector._id);
    }

    // Anchor the parent's spin-off cooldown.
    await db
      .collection<Corporation>("corporations")
      .updateOne({ _id: parent._id }, { $set: { lastSpinOffTurn: turn, updatedAt: now } });

    await emitTx(db, {
      type: "corp_capital_seed",
      turn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: parent._id,
      subjectName: parent.name,
      amount: -costLocal,
      balanceAfter: debit.newBalance,
      currencyCode: parentCurrency ?? "USD",
      counterpartyType: "corporation",
      counterpartyId: newCorpId,
      counterpartyName: nameTrimmed,
      meta: { kind: "spin_off", sectorType, transferredSectors: transferredSectorIds.length },
    });

    return { ok: true, newCorporationId: newCorpId.toString() };
  } catch (err) {
    // Roll back: move any transferred sectors back, delete the new corp, refund.
    if (transferredSectorIds.length > 0) {
      await db
        .collection<CorporateSector>("corporateSectors")
        .updateMany(
          { _id: { $in: transferredSectorIds } },
          { $set: { corporationId: parent._id, updatedAt: new Date() } }
        );
    }
    await db.collection<Corporation>("corporations").deleteOne({ _id: newCorpId });
    await refundCorpLiquidCapital(db, parent._id, costLocal);
    throw err;
  }
}
