import type { Db } from "mongodb";
import type {
  Bond,
  BondMaturityTurns,
  CentralBank,
  Corporation,
  CorporateSector,
} from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE, BOND_MATURITY_LABELS } from "@/lib/db/types/bond";
import {
  buildPrimeRateMap,
  canRefinanceDefaultedDebt,
  computeSectorNpvSum,
  mergeDefaultedBondHolders,
  previewRefinanceIssuance,
  totalEquityForBonds,
  sumDefaultedBondPrincipal,
  sumNonMaturedBondPrincipal,
} from "@/lib/bonds/corporateBondDefault";
import { sumCorporateSectorConstructionInProgress } from "@/lib/bonds/corporateCredit";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { MAX_BOND_DEFAULT_REFINANCES } from "@/lib/constants/bonds";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getCountryConfig } from "@/lib/constants/countries";
import { logWireEvent, wireHeadlineBond } from "@/lib/wireEvent";
import {
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { emitTx } from "@/lib/financialTxLog/emit";
import type { CurrencyCode } from "@/lib/constants/currencies";

export interface CorporationRefinanceResult {
  ok: true;
  bondId: string;
  faceValueAnchor: number;
  couponRate: number;
  maturityTurn: number;
  retiredBondIds: string[];
  bondsMatured: number;
}

export interface CorporationRefinanceInfeasible {
  ok: false;
  reason: string;
}

/**
 * Refinance a corporation's DEFAULTED bonds by issuing a single replacement
 * bond for the full defaulted principal, rolling every defaulted holder into
 * it at par and maturing/curing the old bonds. This is a debt-for-debt swap:
 * NO cash changes hands and NO sectors are sold — the corporation survives with
 * all its assets intact.
 *
 * Enforces the same guardrails as the CEO-initiated route: a lifetime refinance
 * cap (prevents default → refi → cash-injection loops) and the 2×-equity /
 * minimum-issuance leverage check. Returns a discriminated result so both the
 * HTTP route and the turn-tick auto-resolver can branch on feasibility instead
 * of throwing.
 *
 * The caller is responsible for any authorization / national-corp / IMF /
 * game-state guards, and (in the turn tick) for holding the corporation
 * settlement lock.
 */
export async function executeCorporationBondRefinance(
  db: Db,
  corporation: Corporation,
  options: { now: Date; currentTurn: number; maturityTurns: BondMaturityTurns }
): Promise<CorporationRefinanceResult | CorporationRefinanceInfeasible> {
  const { now, currentTurn, maturityTurns } = options;

  const defaultedBonds = await db
    .collection<Bond>("bonds")
    .find({ corporationId: corporation._id, matured: false, defaulted: true })
    .toArray();

  if (defaultedBonds.length === 0) {
    return { ok: false, reason: "No defaulted bonds to refinance" };
  }

  // Cap lifetime refinances to prevent default → refi cash-extraction loops.
  const refiCount = corporation.bondDefaultRefinanceCount ?? 0;
  if (refiCount >= MAX_BOND_DEFAULT_REFINANCES) {
    return { ok: false, reason: "Refinance limit reached" };
  }

  const allNonMatured = await db
    .collection<Bond>("bonds")
    .find({ corporationId: corporation._id, matured: false })
    .toArray();

  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ corporationId: corporation._id })
    .toArray();
  const centralBanks = await db.collection<CentralBank>("centralBanks").find({}).toArray();
  const primeRateByCountry = buildPrimeRateMap(centralBanks);
  const fxByCurrency = await loadFxRatesByCurrency(db);
  // Under plants the growth-cost deduction is a phantom charge (growth spend no
  // longer buys capacity), so leaving it in here would understate equity and
  // deny refinances the bond-default panel just told the CEO were available.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  const sectorNPV = computeSectorNpvSum(sectors, primeRateByCountry, corporation, fxByCurrency, {
    plantsEnabled,
  });
  const corpFxRate = await getCorpFxRate(db, corporation);
  const liquidCapitalAnchor = corpLiquidCapitalToAnchor(
    corporation.liquidCapital,
    corporation,
    corpFxRate
  );
  // Capitalized build spend is an asset (P3a) — same leg the panel adds.
  const totalEquity = totalEquityForBonds(
    liquidCapitalAnchor,
    sectorNPV,
    sumCorporateSectorConstructionInProgress(sectors, corporation._id)
  );

  // All values passed to canRefinanceDefaultedDebt are in ₳ so the 2×-equity
  // leverage check compares coherent units. `refi.requiredFace` is also in ₳ —
  // converted to LOCAL at bond-creation time below so the new bond's
  // `totalIssued` matches its `currencyCode`.
  const exactDefaultedPrincipal = sumDefaultedBondPrincipal(defaultedBonds, fxByCurrency);
  const existingDebtAll = sumNonMaturedBondPrincipal(allNonMatured, fxByCurrency);

  const refi = canRefinanceDefaultedDebt({
    equity: totalEquity,
    existingDebtAllNonMatured: existingDebtAll,
    defaultedPrincipal: exactDefaultedPrincipal,
  });

  if (!refi.ok) {
    return { ok: false, reason: "Cannot refinance within debt limits" };
  }

  const bondCurrencyCode = resolveCorpLiquidCurrencyCode(corporation);
  const actualFaceAnchor = refi.requiredFace;

  // Merge holders first so totalUnits derives from the original bonds' actual
  // unit counts rather than an ₳↔local round-trip. For high-FX currencies
  // (JPY ~87×), flooring to the nearest 1,000 ₳ then converting back to JPY
  // can drop 10–80 units below the original holder total, causing a spurious
  // "Bond holder data does not match" error that blocks all refinances.
  const merged = mergeDefaultedBondHolders(defaultedBonds);
  const holders: Bond["holders"] = [];
  let holderUnitSum = 0;
  for (const h of merged.holderUnits.values()) {
    holders.push({ characterId: h.characterId, units: h.units });
    holderUnitSum += h.units;
  }
  for (const h of merged.imperialHolderUnits.values()) {
    holders.push({ imperialCharacterId: h.imperialCharacterId, units: h.units });
    holderUnitSum += h.units;
  }
  for (const h of merged.corpHolderUnits.values()) {
    holders.push({ corporationId: h.corporationId, units: h.units });
    holderUnitSum += h.units;
  }
  const publicFloatFinal = Math.max(0, merged.publicFloat);
  const totalUnits = holderUnitSum + publicFloatFinal;
  const actualFaceValueLocal = totalUnits * BOND_UNIT_FACE_VALUE;

  const latestHistory = await db
    .collection("corporationHistory")
    .findOne({ corporationId: corporation._id }, { sort: { turn: -1 } });
  const annualIncome = (latestHistory?.income ?? 0) * TURNS_PER_YEAR;

  const countryId = corporation.countryId;
  const centralBank = centralBanks.find((bank) => bank.countryId === countryId);
  const primeRate =
    centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;

  const { couponRate } = previewRefinanceIssuance({
    corporation,
    liquidCapitalAnchor,
    allNonMaturedBonds: allNonMatured,
    actualFaceAnchor,
    sectorNpv: sectorNPV,
    annualIncome,
    primeRate,
    currentTurn,
    fxByCurrency,
    maturityTurns,
  });

  const bondDoc: Omit<Bond, "_id"> = {
    corporationId: corporation._id,
    faceValue: BOND_UNIT_FACE_VALUE,
    couponRate,
    maturityTurns,
    issuedAtTurn: currentTurn,
    maturityTurn: currentTurn + maturityTurns,
    marketPrice: 1.0,
    totalIssued: actualFaceValueLocal,
    publicFloat: publicFloatFinal,
    holders,
    defaulted: false,
    defaultedAtTurn: null,
    matured: false,
    // Refinanced corporate bond inherits issuing corp's home currency.
    currencyCode: bondCurrencyCode,
    createdAt: now,
    updatedAt: now,
  };

  const inserted = await db.collection("bonds").insertOne(bondDoc);

  // Refinancing is a debt-for-debt swap: existing holders are rolled into the new
  // bond at par (no cash changes hands). Do NOT credit the corporation with the
  // face value — there are no new investors purchasing the issuance, so treating
  // it as a cash raise would print phantom money and enable a default → refi
  // cash-extraction loop.
  await db.collection<Corporation>("corporations").updateOne(
    { _id: corporation._id },
    {
      $inc: { bondDefaultRefinanceCount: 1 },
      $set: { updatedAt: now },
    }
  );

  const oldIds = defaultedBonds.map((b) => b._id);
  // Preserve `defaultedAtTurn` (historical mark) and stamp `defaultCure` so the
  // Bonds tab can render the "Default cured" badge. The caller's game-state
  // guard guarantees currentTurn > 0, so the stamp is unconditionally safe.
  await db.collection<Bond>("bonds").updateMany(
    { _id: { $in: oldIds } },
    {
      $set: {
        matured: true,
        marketPrice: 1,
        defaulted: false,
        defaultCure: { cureMethod: "refinance" as const, curedAtTurn: currentTurn },
        updatedAt: now,
      },
    }
  );

  const matLabel = BOND_MATURITY_LABELS[maturityTurns] ?? `${maturityTurns}T`;
  logWireEvent(
    "bond_issued",
    wireHeadlineBond(corporation.name, actualFaceAnchor, matLabel, couponRate.toFixed(1)),
    { href: `/corporation/${corporation.sequentialId ?? corporation._id}` }
  );

  // Cashless bond_issuance row so the new refinance bond shows up in ledger
  // queries alongside ordinary issuances. Refinance is a debt-for-debt swap (no
  // investors paid in), so `amount` is 0; principal magnitude lives in
  // `meta.faceValue`. Without this row, "all bond_issuance events on turn N"
  // silently misses every refinance.
  void emitTx(db, {
    type: "bond_issuance",
    turn: currentTurn,
    createdAt: now,
    subjectType: "corporation",
    subjectId: corporation._id,
    subjectName: corporation.name,
    amount: 0,
    // USD fallback when `bondCurrencyCode` is undefined (corp lacks lc currency
    // AND unrecognized countryId). Avoids `currencyCode: undefined`.
    currencyCode: (bondCurrencyCode ?? "USD") as CurrencyCode,
    meta: {
      bondId: inserted.insertedId.toString(),
      units: totalUnits,
      couponRate,
      maturityTurns,
      refinance: true,
      faceValue: actualFaceValueLocal,
      retiredBondIds: oldIds.map((x) => x.toString()),
    },
  });

  return {
    ok: true,
    bondId: inserted.insertedId.toString(),
    faceValueAnchor: actualFaceAnchor,
    couponRate,
    maturityTurn: currentTurn + maturityTurns,
    retiredBondIds: oldIds.map((x) => x.toString()),
    bondsMatured: defaultedBonds.length,
  };
}
