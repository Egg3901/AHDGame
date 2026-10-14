/** Corporate bids must be deliverable by an authorized CEO's eligible plant and respect existing contract prices. */
import { extractionBidError, defenceBidError } from "./rules";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { isNppOwned } from "@/lib/corporations/nppOwned";
import { getDefenceContractAvailability } from "@/lib/db/collections/defenceProcurementAllocations";
import { resolveDefenseLineFrom } from "@/lib/turn/defenseEnvelope";
import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { requireCeo } from "@/lib/api/corporations/resolveQuery";
import { resolveFillEligibility, FILL_REASON_TEXT } from "@/lib/military/defenceFillEligibility";
import { militaryPriceAnchor } from "@/lib/military/procurement";
import { lotPrice } from "@/lib/military/arsenal";
import { lotProductionCost, lotPriceBand } from "@/lib/military/defenceLotEconomics";
import { loadDefencePriceRatios } from "@/lib/military/defencePriceRatios";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { getGameState } from "@/lib/gameState";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { maxTechTierForPreset } from "@/lib/admin/seed/seedMilitaryUnits";
import { resolveGameYear } from "@/lib/era/era";
import { getStartingYearForPreset, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { isProcurementBlocked } from "@/lib/military/procurementGate";
import type { GovernmentTender, ContractBid } from "./types";

export class ContractError extends Error {
  constructor(
    message: string,
    public status = 409
  ) {
    super(message);
  }
}
export async function validateBid(
  db: Db,
  t: GovernmentTender,
  bid: Pick<ContractBid, "corporationId" | "sectorId" | "amount" | "userId" | "system">,
  turn: number,
  user?: AuthUserWithCharacter
) {
  const corp = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: new ObjectId(bid.corporationId) });
  if (!corp) throw new ContractError("Corporation not found.", 404);
  if (user && requireCeo(corp, user.userId))
    throw new ContractError("Only this corporation's CEO may bid.", 403);
  if (
    !user &&
    !(bid.system && (isStateOwned(corp) || isNppOwned(corp))) &&
    requireCeo(corp, bid.userId)
  )
    throw new ContractError("The bid is no longer authorized by this corporation's CEO.");
  if (t.terms.type === "extraction") {
    const sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ corporationId: corp._id, stateId: t.terms.stateId }, { projection: { _id: 1 } });
    const invalid = extractionBidError({
      corporationType: corp.type,
      hasOperations: !!sector,
      amount: bid.amount,
      minimum: t.terms.minimumSigningFeeAnchor,
    });
    if (invalid) throw new ContractError(invalid);
    return { corp, sector: null, budget: null, fill: null };
  }
  const gate = await isProcurementBlocked(db, t.countryId, turn);
  if (gate.blocked) throw new ContractError(gate.reason ?? "Procurement is paused.");
  if (!bid.sectorId) throw new ContractError("Choose a defence plant.", 400);
  const sector = await db
    .collection<CorporateSector>("corporateSectors")
    .findOne(
      { _id: new ObjectId(bid.sectorId), corporationId: corp._id, sectorType: "defense" },
      { projection: { corporationId: 1, sectorType: 1, strategyId: 1, revenue: 1 } }
    );
  if (!sector)
    throw new ContractError("The selected defence plant does not belong to this corporation.");
  const state = await getGameState(db);
  const budget = await ensureFederalBudget(db, t.countryId, state?.preset ?? DEFAULT_SEED_PRESET);
  if (!budget) throw new ContractError("No national budget is available.");
  const year =
    resolveGameYear(state ?? {}) ??
    getStartingYearForPreset(state?.preset ?? DEFAULT_SEED_PRESET) +
      Math.floor((turn - 1) / TURNS_PER_YEAR);
  const fill = resolveFillEligibility({
    corp,
    sector,
    countryId: t.countryId,
    currentYear: year,
    component: t.terms.component,
  });
  if (!fill.eligible) throw new ContractError(FILL_REASON_TEXT[fill.reason ?? "no_materiel_line"]);
  const anchor = lotPrice(
    t.countryId,
    militaryPriceAnchor(budget.gdp, budget.militaryPriceBaselineGdp)
  );
  const ratios = await loadDefencePriceRatios(db);
  const cost = anchor == null ? null : lotProductionCost(sector.strategyId, anchor, ratios);
  const band =
    anchor == null || cost == null
      ? null
      : lotPriceBand({ anchorPrice: anchor, productionCost: cost, grade: t.terms.grade });
  const allowance = await getDefenceContractAvailability(db, {
    countryId: t.countryId,
    corporationId: corp._id.toHexString(),
    currentTurn: t.publishedTurn,
    defenseLine: resolveDefenseLineFrom(budget),
    pricePerLot: bid.amount,
    stateOwned: isStateOwned(corp),
  });
  const invalid = defenceBidError({
    supplierGrade: fill.gradeCeiling,
    eraGrade: maxTechTierForPreset(state?.preset ?? DEFAULT_SEED_PRESET),
    requiredGrade: t.terms.grade,
    amount: bid.amount,
    maximum: t.terms.maximumPricePerLot,
    floor: band?.floor ?? null,
    ceiling: band?.ceiling ?? null,
    supplierRemainingLots: allowance.supplierRemaining,
    lots: t.terms.lots,
  });
  if (invalid) throw new ContractError(invalid);
  return { corp, sector, budget, fill };
}
