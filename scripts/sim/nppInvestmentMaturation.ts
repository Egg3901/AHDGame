/** Synthetic eligibility trajectories, not a whole-world economic qualification. */
import assert from "node:assert/strict";
import { CAPACITY_BUILD_TURNS } from "../../src/lib/constants/capacityEconomy";
import type { CorporateSector } from "../../src/lib/db/types";
import {
  allowsNppIndustryInvestment,
  isNppDivestmentProtected,
} from "../../src/lib/turn/npp/rules/investmentProtection";

const results = (["manufacturing", "media", "retail"] as const).map((sectorType) => {
  const start = 100;
  const finish = start + CAPACITY_BUILD_TURNS(sectorType, true);
  const expires = finish + 24;
  const horizon = expires + 24;
  const rows = [];
  for (let turn = start; turn <= horizon; turn++) {
    const building = turn < finish;
    const sector = {
      sectorType,
      plantsStartTurn: start,
      buildQueue: building ? [{ unitsOrdered: 100, startTurn: start, onlineTurn: finish }] : [],
      constructionInProgressAnchor: building ? 1000 : 0,
    } as CorporateSector;
    const protectedInvestment = isNppDivestmentProtected(sector, turn);
    assert.equal(protectedInvestment, turn < expires);
    rows.push({ turn, building, protectedInvestment });
  }
  // Hold a loss signal constant: legacy disposal is possible on the first
  // operating turn; the candidate must survive through build + maturity.
  const legacyEarliestLossExit = start + 1;
  const candidateEarliestLossExit = rows.find((r) => !r.protectedInvestment)!.turn;
  assert.equal(candidateEarliestLossExit, expires);
  return {
    sectorType,
    start,
    finish,
    horizon,
    legacyEarliestLossExit,
    candidateEarliestLossExit,
    evaluatedTurns: rows.length,
  };
});
for (const type of ["construction", "manufacturing", "media", "retail"])
  assert.equal(allowsNppIndustryInvestment("construction", type, true), type === "construction");
console.log(
  JSON.stringify(
    {
      scope:
        "Deterministic synthetic rules trajectories; no database, world prices or balances are mutated. This does not qualify long-horizon macroeconomic balance.",
      verdict: "passed",
      graceOperatingTurns: 24,
      databaseRoundTrips: 0,
      returnedDatabaseBytes: 0,
      newMoneyCreated: 0,
      results,
    },
    null,
    2
  )
);
