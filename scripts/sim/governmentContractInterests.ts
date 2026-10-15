/**
 * Deterministic, offline qualification of extraction conflict penalties.
 * Run: npx tsx scripts/sim/governmentContractInterests.ts
 * Reports to stdout; redirect the report outside the source tree.
 */
import assert from "node:assert/strict";
import { tenderSelfDealingPenalty } from "../../src/lib/governmentContracts/rules/selfDealing";
import { GOVT_CONTRACT_MAX_TOTAL_SHARE } from "../../src/lib/constants/prospecting";
import { selfDealingFavorabilityPenalty } from "../../src/lib/military/defenceSelfDealing";
import type { TenderTerms } from "../../src/lib/governmentContracts/types";

const scenarios = [];
let previous = 0;
for (let percent = 1; percent <= GOVT_CONTRACT_MAX_TOTAL_SHARE * 100; percent++) {
  const share = percent / 100;
  const terms = { type: "extraction", share } as TenderTerms;
  const penalty = tenderSelfDealingPenalty(terms, 0, 0);
  assert(penalty >= 1.5 && penalty <= 8 && penalty >= previous);
  for (const fee of [0, 1, 200, 1e6, 1e9])
    assert.equal(tenderSelfDealingPenalty(terms, fee, 0), penalty);
  assert.equal(
    penalty,
    selfDealingFavorabilityPenalty({ contractValue: share, tranche: GOVT_CONTRACT_MAX_TOTAL_SHARE })
  );
  scenarios.push({ share, penalty });
  previous = penalty;
}
assert.equal(previous, 8);
console.log(
  JSON.stringify(
    {
      qualification: "offline extraction ownership penalty sweep",
      scope: "75 legal concession shares, five signing fees each; no world or database",
      checks: ["bounded", "monotonic", "zero-fee independence", "existing penalty curve"],
      evaluated: scenarios.length * 5,
      scenarios,
    },
    null,
    2
  )
);
