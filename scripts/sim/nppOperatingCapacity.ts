/** Native mechanism qualification; fixed buyers do not model a whole economy. */
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import type { CorporateSector } from "@/lib/db/types";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { assemblePhysicalPnl } from "@/lib/corporations/physicalPnl";
import { scenario, runCase, SECTOR_ID } from "@/lib/test-utils/nppOperatingCapacityFixture";

function trajectory(namedBuyerShock: boolean) {
  let sector: Partial<CorporateSector> = {};
  const turns = [];
  for (let offset = 0; offset < 24; offset++) {
    const current = scenario(sector);
    current.env.turn = current.env.currentTurn = 1000 + offset;
    const buyerUnits = namedBuyerShock && offset >= 6 && offset < 12 ? 200 : 100;
    if (buyerUnits === 200)
      current.env.market.contractProductionTargetBySectorId = new Map([
        [SECTOR_ID.toString(), buyerUnits],
      ]);
    const update = runCase(current);
    const produced = update.producedUnits!;
    const sold = Math.min(buyerUnits, produced);
    const raw = update.plantsPnl!;
    const soldShare = produced > 0 ? sold / produced : 0;
    const revenue = raw.revenue * soldShare;
    const pnl = assemblePhysicalPnl({
      hourlyRevenue: revenue,
      inputsCost: raw.inputs,
      laborCost: raw.labour,
      upkeep: raw.upkeep,
      complianceCost: raw.compliance,
      otherOpex: raw.otherOpexUncapped ?? raw.otherOpex,
      financialLegs: raw.financialLegs,
      internalSupplyDiscountCost: raw.internalSupplyDiscountCost,
      growthCost: 0,
      policyCredit: raw.policyCredit * soldShare,
    });
    sector = {
      ...current.sector,
      ...update,
      soldUnits: sold,
      plantsPnl: { ...raw, revenue, profit: pnl.profit },
    };
    // Apply the actual extra CAS write along with the economic write. No database is used.
    for (const operation of current.env.sectorOps) {
      if ("updateOne" in operation) {
        const set = operation.updateOne.update;
        if (!Array.isArray(set)) Object.assign(sector, set.$set ?? {});
      }
    }
    sector.soldUnits = sold;
    sector.plantsPnl = { ...raw, revenue, profit: pnl.profit };
    assert([produced, sold, pnl.profit, pnl.totalCost].every(Number.isFinite));
    assert(pnl.totalCost >= 0);
    turns.push({
      turn: 1000 + offset,
      buyerUnits,
      produced,
      sold,
      activePercent: sector.activeCapacityPercent ?? 100,
      ownedCapacity: sector.capitalStock!,
      paidBook: sector.capacityBookAnchor!,
      pretaxIncome: pnl.profit / TURNS_PER_DAY,
      payroll: pnl.laborCost / TURNS_PER_DAY,
      upkeep: pnl.upkeep / TURNS_PER_DAY,
      inputs: pnl.inputsCost / TURNS_PER_DAY,
    });
  }
  return {
    namedBuyerShock,
    turns,
    cumulativePretaxIncome: turns.reduce((sum, row) => sum + row.pretaxIncome, 0),
    soldUnits: turns.reduce((sum, row) => sum + row.sold, 0),
    producedUnits: turns.reduce((sum, row) => sum + row.produced, 0),
    payroll: turns.reduce((sum, row) => sum + row.payroll, 0),
  };
}
const scenarios = [false, true].map(trajectory);
const report = {
  scope:
    "Synthetic native sector/P&L trajectories with fixed buyers, neutral prices and no world feedback. Not an aged-world, macro-health, employment or safe-75 qualification.",
  horizon: 24,
  scenarios,
};
const output = process.argv[2];
if (!output) throw new Error("Pass an external output JSON path");
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    scenarios.map((row) => ({
      namedBuyerShock: row.namedBuyerShock,
      income: row.cumulativePretaxIncome,
      sold: row.soldUnits,
      payroll: row.payroll,
      ownedCapacity: row.turns.at(-1)!.ownedCapacity,
    }))
  )
);
