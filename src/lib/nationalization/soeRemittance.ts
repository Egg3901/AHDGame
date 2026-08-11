/**
 * Per-turn National Corporation profit remittance (spec P6g §5.1).
 *
 * A NatCorp's operating profit already accrues to its `liquidCapital` in the corp
 * turn. This phase splits that profit: the CEO-retained share stays in the corp,
 * and the remitted share (≥25%) is transferred to the central-bank reserve. It
 * reuses the same `estimateNationalizedOperatingIncome` the budget revenue line
 * uses (which is scaled by the same remit fraction) so the remitted profit is
 * counted exactly once. Losses are handled separately by `processSoeOperations`.
 */
import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
  fxRateForCorpFromMap,
  anchorToCorpCapital,
} from "@/lib/currency/corporationCapital";
import {
  estimateNationalizedOperatingIncome,
  loadPlantsBudgetContext,
} from "@/lib/budget/publicEnterpriseRevenue";
import { isStateOwned } from "./nationalCorporation";
import { cappedRemittanceLocal } from "./ceoFinance";
import { remitToTreasury } from "./treasury";
import { loadSoeGovernanceInputs } from "./soeGovernanceInputs";

export async function processSoeRemittance(db: Db, now: Date): Promise<{ remitted: number }> {
  const corps = await db
    .collection<Corporation>("corporations")
    .find({ $or: [{ countryOwnerId: { $exists: true } }, { ownershipState: "stateOwned" }] })
    .toArray();
  if (corps.length === 0) return { remitted: 0 };

  const corpIds = corps.map((c) => c._id);
  // PLANTS PARITY. `estimateNationalizedOperatingIncome` takes `plantsEnabled`
  // and the governor-ramp inputs POSITIONALLY, and both default to the
  // pre-plants behaviour. Calling it with four arguments (as this file used to)
  // therefore made the CASH sweep keep deducting the vestigial growth cost and
  // charge neither CIP amortization nor idle upkeep, while the budget revenue
  // line (`calculateCountryOwnedBudgetRevenue`) and the treasury-backing pass
  // (`processSoeOperations`) both passed the real plants context. The docblock
  // above promises these go through the same helper so they stay reconciled;
  // under plants they silently did not. Resolved ONCE per turn here, the same
  // hoist the budget turn does, so this costs at most two extra reads per turn.
  const [allSectors, fxByCurrency, plants] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: { $in: corpIds } })
      .toArray(),
    loadFxRatesByCurrency(db),
    loadPlantsBudgetContext(db),
  ]);

  const stateIds = Array.from(new Set(allSectors.map((s) => s.stateId)));
  // Shares `loadSoeGovernanceInputs` with the budget revenue line so the
  // remittance and that line cannot disagree about a corp's operating income.
  const metricsById = await loadSoeGovernanceInputs(db, stateIds);

  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const s of allSectors) {
    const key = s.corporationId.toString();
    sectorsByCorp.set(key, [...(sectorsByCorp.get(key) ?? []), s]);
  }

  let remitted = 0;
  for (const corp of corps) {
    if (!isStateOwned(corp)) continue;
    const incomeAnchor = estimateNationalizedOperatingIncome(
      corp,
      sectorsByCorp.get(corp._id.toString()) ?? [],
      fxByCurrency,
      metricsById,
      // Positional filler. The SOCI concentration multiplier is a SEPARATE,
      // pre-existing divergence from the budget line (which passes the
      // country's real multiplier); it is left at the identity here so this fix
      // changes nothing below plants, and is deliberately not folded in as a
      // silent side effect of the plants threading.
      1,
      plants.plantsEnabled,
      plants
    );
    if (incomeAnchor <= 0) continue; // losses are treasury-backed in processSoeOperations

    const code = resolveCorpLiquidCurrencyCode(corp);
    const rate = fxRateForCorpFromMap(corp, fxByCurrency);
    const incomeLocal = anchorToCorpCapital(incomeAnchor, code, rate);
    // `estimateNationalizedOperatingIncome` is a revenue-derived ESTIMATE, not the
    // cash actually accrued to liquidCapital — a corp can show "profit" on the
    // estimate while running a real operating loss. cappedRemittanceLocal bounds
    // the remittance to on-hand cash so it never overdraws itself negative (which
    // the treasury would then back-fill — an infinite remit↔back-fill churn). The
    // budget revenue line uses the SAME helper so the two stay reconciled.
    const amountLocal = cappedRemittanceLocal(
      incomeLocal,
      corp.profitRetentionPercent,
      corp.liquidCapital
    );
    if (amountLocal <= 0) continue;

    const countryId = (corp.countryOwnerId ?? corp.countryId) as CountryId;
    await remitToTreasury(db, { countryId, corpId: corp._id, amountLocal }, now);
    remitted++;
  }

  return { remitted };
}
