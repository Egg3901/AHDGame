# Issue #1470 command shortage stress and recovery

The deterministic stress uses the production `countryPhysicalDemandSupplyGapPct`,
`accumulateOverhang`, and `shortageIndexFrom` kernels. RU and DD run the command
path. US is a non-command control and is not processed. The ledger observation is
present for 48 turns, then absent for 48 turns.

The source verification is `src/lib/turn/commodityPriceTurn.ts`: the flow ledger
is built after `applyTradeConvergence`. The `byCountry` row therefore carries the
effective post-trade balance: importer demand is its remaining demand after
`k × imports`, and exporter supply is reduced by `k × exports`. It is not raw
domestic demand or raw domestic production. The synthetic importer regression in
`src/lib/market/flowLedger.test.ts` starts US at supply 100 / demand 200, gives it
imports, and verifies that the persisted row demand falls below 200. The gap
cannot claim a domestic production deficit from demand that imports already
covered.

The stress row is a basis-explicit country ledger observation with supply 1,000,
demand 1,600, and price 1.

Run:

```text
npx tsx scripts/sim/commandShortageStressRecovery.ts
```

Expected output:

| Country | Turn 48 gap | Turn 48 shortage | Turn 96 gap | Turn 96 shortage |
| ------- | ----------: | ---------------: | ----------: | ---------------: |
| RU      |      59.94% |             3.60 |        null |             0.00 |
| DD      |      59.94% |             3.60 |        null |             0.00 |
| US      |        null |             null |        null |             null |

This confirms that the country-scoped gap raises command shortage pressure,
disappearing observations clear the diagnostic and do not remain stale, and the
non-command control remains outside the path. No balance coefficient is added or
tuned by this report.
