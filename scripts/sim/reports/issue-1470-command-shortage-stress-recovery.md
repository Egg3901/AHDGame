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

Observed output:

| Country | Turn 48 gap | Turn 48 shortage | Turn 96 gap | Turn 96 shortage |
| ------- | ----------: | ---------------: | ----------: | ---------------: |
| RU      |      59.94% |             0.72 |        null |             0.00 |
| DD      |      59.94% |             0.72 |        null |             0.00 |
| US      |        null |             null |        null |             null |

This confirms that the country-scoped gap raises command shortage pressure,
disappearing observations clear the diagnostic and do not remain stale, and the
non-command control remains outside the path. The physical-gap coefficient is calibrated from 0.06 to 0.012, keeping the
existing overhang contribution unchanged. A maximum 500% observed gap now adds
six shortage points. At 60% repression, that adds at most 1.728 legitimacy points
per 48-turn year with other drivers held fixed, versus 8.64 at the original
coefficient. This bounds the new direct consequence while leaving the signal
monotonic and preserving NPP responses to observed scarcity.

For illustrative gaps of 360% and 270%, physical contributions are 4.32 and 3.24
shortage points. The actual growth, policy and marketization feedbacks still need
coupled-world validation; this kernel report does not certify their total size.
