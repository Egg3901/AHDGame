import { ObjectId, type Db } from "mongodb";
import type { BankLoan } from "@/lib/db/types/bank";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import { computeSectorListingValuation } from "@/lib/corporations/sectorValuation";
import { sectorNpvBoostMultiplier } from "@/lib/corporations/rules/marketBoost";
import {
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

/** Expose defaulted security to funded buyers. A book mark never pays a creditor. */
export async function listDefaultedConstructionCollateral(db: Db, turn: number): Promise<number> {
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({
      "constructionFinancing.status": "building",
      "constructionFinancing.defaultedTurn": { $lt: turn },
      "constructionFinancing.foreclosure": { $exists: false },
      "constructionFinancing.sale": { $exists: false },
      "constructionFinancing.escrowLocal": 0,
      constructionPropertyTransition: { $exists: false },
    })
    .limit(200)
    .toArray();
  if (sectors.length === 0) return 0;
  const loanIds = sectors.flatMap((sector) =>
    ObjectId.isValid(sector.constructionFinancing?.loanId ?? "")
      ? [new ObjectId(sector.constructionFinancing!.loanId)]
      : []
  );
  const [loans, owners, rates, eraUnitScale, gameState] = await Promise.all([
    db
      .collection<BankLoan>("bankLoans")
      .find({ _id: { $in: loanIds }, status: "defaulted", outstanding: { $gt: 0 } })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: sectors.map((sector) => sector.corporationId) } })
      .toArray(),
    loadFxRatesByCurrency(db),
    loadWorldEraUnitScale(db),
    db.collection<{ _id: string; currentYear?: number }>("gameState").findOne({ _id: "current" }),
  ]);
  const loanMap = new Map(loans.map((loan) => [String(loan._id), loan]));
  const ownerMap = new Map(owners.map((owner) => [String(owner._id), owner]));
  let listed = 0;
  for (const sector of sectors) {
    const claim = sector.constructionFinancing!,
      loan = loanMap.get(claim.loanId),
      owner = ownerMap.get(String(sector.corporationId));
    if (
      !owner ||
      !loan?.constructionCollateral ||
      String(owner._id) !== claim.borrowerId ||
      loan.constructionCollateral.claimId !== claim.claimId ||
      !loan.constructionCollateral.sectorId.equals(sector._id) ||
      loan.charteredTurn !== claim.charteredTurn ||
      String(loan.bankCorporationId) !== claim.bankId ||
      loan.currency !== claim.currency
    )
      continue;
    const hostCurrency = resolveSectorHostCurrencyCode(sector, owner);
    const hostRate = hostCurrency ? rates.get(hostCurrency) : undefined;
    if (!Number.isFinite(hostRate) || !(hostRate! > 0)) continue;
    const valuation = computeSectorListingValuation(
      sector,
      owner,
      hostRate!,
      true,
      {
        sector,
        currentYear: gameState?.currentYear,
        currentTurn: turn,
        eraUnitScale,
      },
      sectorNpvBoostMultiplier(turn)
    );
    if (!Number.isFinite(valuation.priceAnchor) || valuation.priceAnchor <= 0) continue;
    const now = new Date();
    const result = await db.collection<CorporateSector>("corporateSectors").updateOne(
      {
        _id: sector._id,
        corporationId: owner._id,
        "constructionFinancing.claimId": claim.claimId,
        "constructionFinancing.defaultedTurn": claim.defaultedTurn,
        "constructionFinancing.status": "building",
        "constructionFinancing.foreclosure": { $exists: false },
        "constructionFinancing.sale": { $exists: false },
        "constructionFinancing.escrowLocal": 0,
        constructionPropertyTransition: { $exists: false },
      },
      {
        $set: {
          forSale: {
            listedAt: now,
            foreclosed: true,
            pledged: true,
            priceAnchor: valuation.priceAnchor,
            npvAnchor: valuation.npvAnchor,
          },
          "constructionFinancing.foreclosure": { turn },
          updatedAt: now,
        },
      }
    );
    if (result.matchedCount === 1) listed++;
  }
  return listed;
}
