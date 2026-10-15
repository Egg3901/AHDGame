# Operating-model identity at the supply-demand boundary

Question: does the real clearing pre-pass reserve and internally deliver the
inputs required by the plant's actual operating model?

Run:

```sh
npx vitest run src/lib/turn/corporation/clearingPrePass.test.ts src/lib/market/internalSupply/clearing.test.ts src/lib/turn/corporation/settleSupplyAgreements.test.ts --maxWorkers=1
```

Result: 90 focused tests pass. Four new integrated pre-pass regressions failed
before forwarding the two existing identity fields and pass afterward:

- Vehicle standard method reserves steel demand, matching the model-aware rule.
- Entertainment standard method reserves energy demand, matching that rule.
- Actual own-company clearing delivers steel to the vehicle plant.
- Actual own-company clearing delivers energy to the entertainment plant.

The delivery cases assert equal seller reservations and buyer receipts. Existing
tests cover clearing, named allocation and settlement accounting. Three additional
pre-pass controls match hardware input demand to the existing relief rule before
activation, at the first phase-in turn and at completion: turns 221, 222 and 233.

The fixture is synthetic. It uses one million anchor revenue and 100 capacity and
produced units. Before the fix the vehicle contract demand omitted 262.5 steel
units, while entertainment demand omitted 1,000 energy units and included the
parent media category's consulting input. Both field types and the shared demand
calculator already supported operating models; only the pre-pass projection lost
them. The patch adds no database calls or changes to formulas, prices, units,
transition timing, schema, cash settlement or historical compensation.

This qualifies the bounded phase boundary and its own-company clearing result,
not a complete world trajectory, all inherited ownership policies or historical
player losses. Existing contract limits and market constraints can still restrict
delivery. Hosted qualification and sequential staging/production observation are
required before claiming the correction live.
