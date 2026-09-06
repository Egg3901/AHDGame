# Macro action parity fixture

Observed from `scripts/sim/macroActionParity.test.ts` on synthetic, public-safe state. The fixture invokes the production Gosbank POST route with an in-memory `updateOne` spy, captures the exact persisted `creditAggressiveness` and `budgetSoftness` fields, and supplies those captured values to the real `processCommandEconomyTurn` twice:

- Player case: captured `economicFactors.gosbankDirective` takes precedence over a different NPP stance.
- NPP case: the same captured values are placed in `governmentFormations.commandStance`, with no player directive.

Both process-turn executions produced equal persisted `budgetSoftness` and `monetaryOverhang`. Route authorization and exact directive persistence are asserted before the turn phase runs. This is the common-control parity boundary. `sectorCredit` is deliberately excluded because it is a player directive field with no NPP `commandStance` equivalent.

The fixture also runs the plants branch with one real synthetic SOE and one corporate sector in an instrumented in-memory database. Both controller cases emit the same corporate-sector `$inc` to `capitalStock` and the same SOE overlay write after normalizing generated document ids. The captured plants write is `capitalStock += 0.05` at this era-priced tranche, while the source fixture's `producedUnits` and inventory fields remain unchanged. A direct production-kernel assertion separately confirms that a 50 credit tranche with 25 capacity value added raises capacity by 25 while leaving output unchanged. This verifies that plants credit buys capacity and does not create physical goods in the overlay.

`investmentRequest` remains a player SOE Director input with no NPP per-enterprise equivalent, so parity is not claimed for it. The only production change is moving the existing Gosbank directive-over-stance precedence into `src/lib/economy/commandEconomyPosture.ts` and using that helper from the turn phase for direct fixture coverage. No balance rule was changed.

Scope: this synthetic fixture compares persisted posture, SOE overlay and sector capital allocation. Shadow-ledger posting is disabled in the fixture; it does not certify cash or ledger conservation, full player authorization context resolution, controller decision quality, or all economic actions. Sector write assertions prohibit changes to produced units and inventory.
