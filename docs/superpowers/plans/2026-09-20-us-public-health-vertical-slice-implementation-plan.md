# US Public Health Vertical Slice Implementation Plan

> Planning artifact only. This document does not authorize implementation, schema migration, or balance changes. The implementation issue required by `AGENTS.md` must exist before Task 1 begins.

**Goal:** Prove or falsify the legislative administration model with one existing US option, `public_health_opt_1` of `us_public_health`, by carrying its authorization, included appropriation, department account, typed capacity, delivered outcome, repeal, and player explanation through the production turn pipeline and a deterministic headless harness.

**Design source:** `docs/superpowers/specs/2026-09-20-legislative-cabinet-and-metrics-modernization-design.md`

**Proof boundary:** One country, one policy option, one durable portfolio, one era-resolved department, one operating account, one capacity type, and one direct outcome. Nothing in this plan generalizes the model to other laws or countries before Gate 1.

**Architecture:** Add a small portable rules core under `src/lib/governmentFinance/rules/`. The shell projects one US budget, the active public-health law, and the required state/outcome inputs; calls the rules with plain data; commits a guarded, idempotent sub-ledger settlement; and exposes the resulting implementation factor to the existing policy-effects pass. The federal budget remains the sovereign expense owner. The department account is a control sub-ledger and never charges the treasury again.

**Tech stack:** TypeScript, MongoDB, Vitest, React, the existing turn-phase runtime, and scripts under `scripts/sim/`.

## 1. Decision summary

### The proof case

Use the already-authored `Public Health Workforce Expansion Act`:

| Field | Frozen slice value |
|---|---|
| Legislation type | `us_public_health` |
| Policy option | `public_health_opt_1` |
| Existing cost | 93 local-currency units per resident per year |
| Portfolio | `health` |
| Department id | `us_health_department` |
| Cabinet controller | `secretary_of_health` |
| Funding semantics | `appropriation_included` |
| Account class | `operating` |
| Priority tier | 6, newly authorized initiatives and expansions |
| Capacity type | `public_health_operations` |
| Jurisdiction | `national_direct` |
| Outcome | `healthcare.publicHealthPreparedness` |

The department display name continues to resolve through the existing HEW/HHS era configuration. The account identity is stable when the display name or officeholder changes.

### What this slice must answer

1. Can an enacted program be legally active but only partly delivered?
2. Can the national budget charge be reconciled exactly with a department sub-ledger without a second treasury debit?
3. Can funding and administrative capacity bind independently and remain understandable to a player?
4. Can the delivered contribution replace only this option's legacy direct effect while preserving every other valid contributor to the same metric?
5. Can the same plain-data rules produce identical results in the server turn, unit tests, deterministic simulation, and an isolated Mongo test-world run?

### Foundational decisions for the slice

- The policy law supplies authorization and program design.
- The current calculated law cost in `FederalSpending.byCategory.healthcare` is the compatibility source of annual budget authority for this option.
- `processTreasuryTurn` remains the only sovereign treasury charge. Department accrual mirrors the already-charged slice and is never another expense.
- A missing account is initialized to zero and then funded only by the calculated included appropriation. There is no GDP fallback or one-year heal.
- The program cannot overdraft. Unavailable authority reduces `fundingRatio`.
- Capacity is typed throughput with a source breakdown. It is not money and does not increase instantly merely because funding exists.
- The outcome multiplier is `fundingRatio * capacityRatio * coverageRatio * rampFactor`, with each factor clamped to `[0, 1]` and applied exactly once.
- Officeholder changes alter the controller reference only. They do not move or recreate the account.
- Repeal blocks new obligations, preserves valid encumbrances, and starts a deterministic wind-down.
- Flag-off behavior is the current production behavior, including the current fiscal and policy-effect paths.

The authorization/appropriation split follows the neutral institutional distinction described by the [Congressional Research Service](https://www.congress.gov/crs_external_products/RS/PDF/RS20371/RS20371.13.pdf): authorization establishes or continues a program, while appropriation provides budget authority. The account invariant also follows the [GAO Principles of Federal Appropriations Law](https://www.gao.gov/legal/appropriations-law/red-book), which organizes obligation controls around the relevant appropriation's purpose, time, and amount. These are modeling references, not an assessment of the policy itself.

## 2. Scope

### In scope

- Optional administration metadata for `us_public_health` and implementation metadata for `public_health_opt_1`.
- An off-by-default `departmentProgramSliceEnabled` world flag.
- One persistent department account embedded in the US `FederalBudget` document.
- One program implementation record inside that account.
- Pure rules for included appropriation accrual, priority allocation, capacity, implementation, replay, and repeal/wind-down.
- A turn phase after `treasuryTurn` and before `policyEffects` consumes delivered implementation.
- A narrowly scoped adapter that suppresses only the migrated option's unscaled legacy law effect while the flag is on.
- A read-only API view and minimal Health Secretary office panel.
- Unit, property-style, integration, deterministic simulation, test-server, and turn-performance evidence.
- A Gate 1 report that ends in exactly one recorded decision: `generalize`, `revise_and_rerun`, or `stop`.

### Out of scope

- UK or Japan implementation.
- Any other US law or department.
- Regional department accounts, Cabinet equivalents, grants, or co-funding.
- Player controls for hiring staff, constructing facilities, or changing departmental allocation.
- Defense or intelligence schema migration.
- Cabinet estates, energy plants, infrastructure, capital accounts, or general procurement.
- NPP/AI allocation behavior.
- Metric consolidation beyond source attribution for `publicHealthPreparedness`.
- Rebalancing the option's authored cost or effect magnitude.
- New policy options or changes to political stance labels.

## 3. Required repository and issue setup

### Task 0: Open the implementation issue and freeze evidence

**Why first:** The repository requires an issue before new mechanics, schema changes, or balance work. The issue is also the Gate 1 record.

**Files:**

- Reference: `docs/superpowers/specs/2026-09-20-legislative-cabinet-and-metrics-modernization-design.md`
- Reference: this plan
- Create during implementation: `scripts/sim/reports/public-health-vertical-slice.md`

- [ ] Create one implementation issue titled around the US public-health vertical slice.
- [ ] Link the formal design and this plan.
- [ ] Copy the eleven acceptance criteria from Section 12 into the issue.
- [ ] Record that the 100-million-resident numerical fixture is a rules fixture, not approved production balance.
- [ ] Record the initial source inventory for `healthcare.publicHealthPreparedness` using:

```powershell
rg -n "publicHealthPreparedness" src scripts
```

- [ ] Record the current tests as a characterization baseline:

```powershell
npm run test:run -- src/lib/cabinet/rosterEra.test.ts src/lib/budget/costs.test.ts
```

- [ ] Capture a flag-off deterministic result for `us_public_health` before changing behavior.
- [ ] Do not begin schema work until the issue exists.

**Exit:** The issue names the proof boundary, acceptance criteria, owner, and Gate 1 decision process. Baseline evidence is attached.

## 4. Target data model

The slice deliberately uses one budget document so the sovereign expense and its control sub-ledger can be reconciled and committed atomically. No new collection is introduced.

### Legislation metadata

Add optional law-level ownership to `LegislationType` and optional option-level delivery metadata to `LegislationPolicyOption`:

```ts
interface LegislationAdministration {
  primaryPortfolioId: string;
  primaryDepartmentId: string;
  responsiblePositionId: string;
  jurisdictionMode: "national_direct";
}

interface PolicyOptionImplementation {
  programId: string;
  fundingSemantics: "appropriation_included";
  appropriationClass: "operating";
  obligationPriority: 6;
  capacityType: string;
  outcome: {
    category: MetricCategoryId;
    metricId: string;
  };
}
```

Both fields are optional. Missing metadata remains on the legacy path.

### Department account on `FederalBudget`

```ts
interface DepartmentCapacityPool {
  capacityType: string;
  availableThroughput: number;
  maintenanceDemand: number;
  sourceBreakdown: {
    workforce: number;
    facilities: number;
    systems: number;
    efficiency: number;
  };
}

interface DepartmentProgramState {
  programId: string;
  legislationTypeId: string;
  policyOptionId: string;
  status: "authorized" | "operating" | "winding_down" | "closed";
  annualDemand: number;
  authorityThisTurn: number;
  obligated: number;
  outlaid: number;
  arrears: number;
  fundingRatio: number;
  capacityRatio: number;
  coverageRatio: number;
  rampFactor: number;
  implementationFactor: number;
  bindingConstraint: "funding" | "capacity" | "ramp" | "none";
  lastSettledTurn: number;
  repealTurn?: number;
}

interface DepartmentAccount {
  departmentId: string;
  portfolioId: string;
  balance: number;
  encumbered: number;
  accruedThroughTurn: number;
  capacityPools: Record<string, DepartmentCapacityPool>;
  programs: Record<string, DepartmentProgramState>;
}

interface FederalBudget {
  // existing fields...
  departmentAccounts?: Record<string, DepartmentAccount>;
}
```

Rules use integer local-currency minor units internally. Persisted presentation values may remain whole local-currency units if that is the repository's established budget convention, but reconciliation tests use exact integer arithmetic and never floating point currency comparisons.

### Why embed for this slice

- One projected `federalBudget` read supplies the sovereign spending line and account state.
- One guarded update can advance the turn marker, account balance, encumbrance, and program state together.
- The implementation record cannot drift away from its account.
- The test directly answers whether a one-document control ledger is understandable and operational before introducing generalized collections.
- Gate 1 may still reject this storage choice. No later system may depend on it before that decision.

## 5. Portable rules core

### Task 1: Add rule types and conservation helpers

**Files:**

- Create: `src/lib/governmentFinance/rules/types.ts`
- Create: `src/lib/governmentFinance/rules/reconciliation.ts`
- Test: `src/lib/governmentFinance/rules/reconciliation.test.ts`

- [ ] Define plain-data inputs and outputs for account opening state, appropriation, obligations, capacity, program state, and settlement.
- [ ] Define one currency helper that rejects non-finite and negative inputs and rounds at the boundary.
- [ ] Define the conservation identity:

```text
opening balance
+ authority accrued
- outlays
= closing balance

closing balance
= available balance + encumbered
```

- [ ] Define program-flow identities:

```text
0 <= outlays <= obligated <= available authority
0 <= encumbered <= closing balance
arrears == 0 for this discretionary slice
```

- [ ] Return structured invariant failures. Do not log, query, throw environment-specific errors, or mutate inputs in the rules module.
- [ ] Add tests for zero values, rounding edges, invalid input rejection, and exact conservation.

**Exit:** The reconciliation helper can prove valid fixtures and explain invalid ones without Mongo or globals.

### Task 2: Implement appropriation and priority allocation

**Files:**

- Create: `src/lib/governmentFinance/rules/appropriation.ts`
- Create: `src/lib/governmentFinance/rules/allocation.ts`
- Test: `src/lib/governmentFinance/rules/appropriation.test.ts`
- Test: `src/lib/governmentFinance/rules/allocation.test.ts`

- [ ] Calculate per-turn included authority as the migrated option's resolved annual spending contribution divided by `TURNS_PER_YEAR`.
- [ ] Treat authority as zero when the option is not active, metadata is missing, or the feature flag is off.
- [ ] Use `accruedThroughTurn` to make a same-turn replay return a no-op settlement.
- [ ] Implement all seven priority tiers in the type and allocator even though the slice uses tier 6. This prevents the proof from hard-coding an ordering that cannot represent the approved rule.
- [ ] Allocate pro rata within a tier when authority is short.
- [ ] Prohibit tier 6 from consuming authority reserved for higher tiers.
- [ ] Do not permit an overdraft or negative balance.
- [ ] Add a characterization test proving the department accrual equals the already-calculated healthcare contribution and does not change `treasuryBalance`.

**Exit:** Full, partial, and zero authority settle deterministically, conserve funds, and replay safely.

### Task 3: Implement capacity, delivery, and repeal

**Files:**

- Create: `src/lib/governmentFinance/rules/capacity.ts`
- Create: `src/lib/governmentFinance/rules/implementation.ts`
- Create: `src/lib/governmentFinance/rules/repeal.ts`
- Test: `src/lib/governmentFinance/rules/capacity.test.ts`
- Test: `src/lib/governmentFinance/rules/implementation.test.ts`
- Test: `src/lib/governmentFinance/rules/repeal.test.ts`

- [ ] Calculate maintained throughput from the explicit source breakdown and maintenance demand.
- [ ] Calculate `capacityRatio = min(1, maintainedThroughput / programDemand)` with defined zero-demand behavior.
- [ ] Calculate `fundingRatio`, `coverageRatio`, and `rampFactor` independently.
- [ ] Calculate `implementationFactor` by multiplying each factor once and clamping the result.
- [ ] Identify the binding constraint from the smallest active factor. Use a stable tie-break order for equal values.
- [ ] Advance ramp state from the passed turn number. Do not use the wall clock.
- [ ] On repeal, reject new obligations, retain existing encumbrances, and transition `operating -> winding_down -> closed` from explicit inputs.
- [ ] Keep every rule synchronous and free of Mongo, `process.env`, network access, Sentry, `Date`, and `Math.random()`.

**Required fixture assertions:**

```text
annual demand:           9,300,000,000
annual authority:        6,975,000,000
funding ratio:                     0.75
capacity ratio:                    0.80
coverage ratio:                    1.00
ramp factor:                       0.50
implementation factor:             0.30
outlays:                5,000,000,000
encumbered:             1,500,000,000
available:                475,000,000
```

**Exit:** The entire required experiment matrix runs as pure unit tests.

## 6. Catalog, flag, and persistence shell

### Task 4: Add the off-by-default feature flag and slice metadata

**Files:**

- Modify: `src/lib/db/types/gameState.ts`
- Create: `src/lib/governmentFinance/featureFlag.ts`
- Test: `src/lib/governmentFinance/featureFlag.test.ts`
- Modify: `src/lib/db/types/legislation.ts`
- Modify: `src/lib/seeds/reference/legislationTypes.ts`
- Test: `src/lib/db/types/legislation.test.ts`
- Test: `src/lib/seeds/reference/policyOptionIdInvariants.test.ts` or the nearest existing catalog invariant test found during implementation

- [ ] Add `departmentProgramSliceEnabled?: boolean` to `GameState`; only literal `true` enables the slice.
- [ ] Project only that field in the flag resolver and accept preloaded turn state so the turn path does not add a per-program flag query.
- [ ] Add optional `administration` and `implementation` metadata types.
- [ ] Author the frozen metadata only on `us_public_health` and `public_health_opt_1`.
- [ ] Assert the option id, portfolio id, department id, responsible position id, capacity type, jurisdiction, and outcome path.
- [ ] Assert every other option and legislation type remains unchanged.
- [ ] Keep the flag out of default seeds for production worlds or seed it explicitly false according to the repository's established flag convention.

**Exit:** Metadata is inert while the flag is absent or false.

### Task 5: Add the department definition and account storage helpers

**Files:**

- Create: `src/lib/governmentFinance/departments.ts`
- Test: `src/lib/governmentFinance/departments.test.ts`
- Modify: `src/lib/db/types/budget.ts`
- Create: `src/lib/db/collections/departmentAccounts.ts`
- Test: `src/lib/db/collections/departmentAccounts.test.ts`

- [ ] Define stable `us_health_department` ownership by the `health` portfolio and `secretary_of_health` controller.
- [ ] Resolve the display name through the existing Cabinet mechanics and year resolver. Do not duplicate HEW/HHS year rules.
- [ ] Initialize an absent account to zero authority plus an explicitly supplied capacity seed. Do not derive money from GDP or annual demand.
- [ ] Write a projected budget getter for the account, healthcare spending contribution, GDP/population fields required by the existing cost resolver, and no unrelated budget payload.
- [ ] Commit settlements with a compare-and-swap guard over `accruedThroughTurn`, opening balance, and opening encumbrance.
- [ ] A compare-and-swap miss returns a retryable result. It never overwrites a concurrent player or turn write.
- [ ] Add tests for concurrent attempts: one commit succeeds, one retries, and authority accrues once.
- [ ] Add tests proving officeholder changes do not touch the account.

**Exit:** The account is persistent, zero-safe, idempotent, and independent of the current officeholder.

### Task 6: Build the turn shell

**Files:**

- Create: `src/lib/turn/departmentProgramSettlement.ts`
- Test: `src/lib/turn/departmentProgramSettlement.test.ts`
- Modify: `src/simulation/phases/turnPhaseRegistry.ts`
- Modify: `src/simulation/phases/turnPhaseNames.ts`
- Modify: `src/simulation/phases/simTurnProfiles.ts`
- Modify: `src/simulation/engine/turnPhaseBudgets.ts`
- Modify: `src/lib/db/types/turnLog.ts`
- Test: `src/simulation/phases/turnPhaseRegistry.test.ts`
- Test: `src/simulation/engine/turnReadProjections.test.ts`

- [ ] Name the phase `departmentProgramSettlement`.
- [ ] Run it after `treasuryTurn`, because the sovereign fiscal slice for the turn must settle first.
- [ ] Complete it before `policyEffects`, because the policy pass consumes this turn's implementation factor.
- [ ] When the flag is off, mark the phase skipped with `featureDisabled` and perform no account writes.
- [ ] Load the active US public-health enacted law and the relevant legislation metadata in bounded queries.
- [ ] Project `legislationTypes.policyOptions` only because this phase prices one option. Add the required full-read comment only if the projection test proves a narrower projection is impossible.
- [ ] Reuse `calculateEnactedLawAnnualCost` or the same canonical cost resolver. Do not duplicate the 93-per-resident formula.
- [ ] Build one plain-data rules input, call the rules, reconcile, then issue one guarded budget update.
- [ ] Retry a compare-and-swap miss a bounded number of times from a fresh projection.
- [ ] Report counts and money-flow totals in turn telemetry without logging player data.
- [ ] Measure the phase and set its round-trip budget from evidence. Do not assign a guessed budget.

**Target round-trip shape:** one game-state value already available from context, one projected budget read, one active-law/catalog batch, one guarded write. Any larger measured shape requires explanation in the report.

**Exit:** The server turn has one observable, bounded, replay-safe settlement phase.

## 7. Outcome cutover and attribution

### Task 7: Replace only the migrated option's legacy effect

**Files:**

- Modify: `src/lib/policyEffects.ts`
- Create: `src/lib/governmentFinance/deliveryMultiplier.ts`
- Test: `src/lib/governmentFinance/deliveryMultiplier.test.ts`
- Test: `src/lib/policyEffects.departmentDelivery.test.ts`
- Modify if needed: `src/lib/api/stateTickRates.ts`
- Test if modified: `src/lib/api/stateTickRates.test.ts`

- [ ] Load the country-level program implementation factor once per policy-effects pass, not once per state.
- [ ] Extend the active-policy input with an optional `deliveryMultiplier` that defaults to `1`.
- [ ] Apply the multiplier only when all of these match: flag on, `US`, `us_public_health`, `public_health_opt_1`, national scope, and a valid current-turn implementation record.
- [ ] When the slice is enabled but the record is absent or stale, fail closed with multiplier `0` and an explanation code. Do not silently restore the full legacy effect.
- [ ] Preserve Cabinet-order, estate, corporate, baseline, crisis, and metric-engine contributors to `publicHealthPreparedness`.
- [ ] Ensure tooltip/tick-rate calculations use the same multiplier so the UI never advertises the unscaled effect.
- [ ] Add a source-attribution test proving the migrated law contribution appears once and independent contributors still compose.
- [ ] Add a flag-off byte-equivalence test against the pre-slice characterization fixture.

**Exit:** The law's outcome changes only through delivered implementation while other valid sources remain intact.

## 8. Read model and minimal player surface

### Task 8: Add one read-only department program view

**Files:**

- Create: `src/lib/governmentFinance/readModel.ts`
- Test: `src/lib/governmentFinance/readModel.test.ts`
- Create: `src/app/api/country/[code]/executive/cabinet/[positionId]/department-programs/route.ts`
- Test: `src/app/api/country/[code]/executive/cabinet/[positionId]/department-programs/route.test.ts`
- Modify: `src/app/country/[code]/executive/cabinet/[positionId]/office/useCabinetOffice.ts`
- Create: `src/app/country/[code]/executive/cabinet/[positionId]/office/components/DepartmentProgramPanel.tsx`
- Test: `src/app/country/[code]/executive/cabinet/[positionId]/office/components/DepartmentProgramPanel.test.tsx`
- Modify: `src/app/country/[code]/executive/cabinet/[positionId]/office/page.tsx`
- Modify if needed: `src/app/country/[code]/executive/cabinet/[positionId]/office/cabinetTabs.ts`
- Test if modified: `src/app/country/[code]/executive/cabinet/[positionId]/office/cabinetTabs.test.ts`

- [ ] Restrict the route with the existing Cabinet visibility and office-authorization helpers.
- [ ] Before editing the route or page, read the applicable guide under `node_modules/next/dist/docs/` as required by `AGENTS.md` and follow this repository's installed Next.js version.
- [ ] Return no financial details to a viewer who cannot view the office.
- [ ] Return an empty, explicit flag-off payload rather than exposing partial account state.
- [ ] Show department display name, program status, annual demand, authority, available balance, encumbrance, outlays, and no arrears for this discretionary program.
- [ ] Show funding, capacity, coverage, ramp, implementation, and binding-constraint explanations as labeled ratios. These are operational game-state measurements, not evaluations of the policy.
- [ ] Show the capacity source breakdown and maintenance demand.
- [ ] Show whether the program is authorized, operating, winding down, or closed.
- [ ] Show the resulting preparedness contribution separately from the total metric so other contributors remain legible.
- [ ] Do not add allocation controls. This slice is observational.
- [ ] Add accessibility assertions for labels, status text, and non-color-only constraint communication.

**Exit:** A player can answer, from one screen, why the authorized program delivered its current effect.

## 9. Verification plan

### Task 9: Unit and property-style invariant suite

**Files:**

- Create: `src/lib/governmentFinance/rules/publicHealthSlice.matrix.test.ts`
- Create: `src/lib/governmentFinance/rules/publicHealthSlice.properties.test.ts`

Run every case through the same exported settlement function:

| Case | Funding | Capacity | Required assertions |
|---|---:|---:|---|
| Fully funded baseline | 100% | 100% | Full delivery after ramp; exact reconciliation |
| Appropriation shortfall | 50% | 100% | Funding binds; no overdraft; no free outcome |
| Workforce bottleneck | 100% | 50% | Capacity binds; unused authority remains in account |
| Dual bottleneck | 50% | 50% | Each factor is applied once |
| Officeholder turnover | 100% | 100% | Controller changes; account and program continue |
| Repeal with encumbrance | variable | variable | No new obligations; commitments and wind-down survive |
| Feature flag off | variable | variable | Legacy output is byte-equivalent |

Property-style loops should cover bounded generated inputs without introducing a dependency:

- [ ] Opening balance, authority, demand, capacity, and encumbrance over a documented integer range.
- [ ] Conservation holds for every valid input.
- [ ] No monetary field becomes negative or non-finite.
- [ ] Increasing funding while all other inputs are fixed never lowers delivery.
- [ ] Increasing capacity while all other inputs are fixed never lowers delivery.
- [ ] Replaying a settled turn changes nothing.
- [ ] Closing encumbrance never exceeds closing balance.
- [ ] A repealed program never accepts a new obligation.
- [ ] Server and harness serialization of the same result is byte-for-byte identical.

**Exit:** The rules core has deterministic coverage beyond hand-selected examples.

### Task 10: Turn integration and concurrency tests

**Files:**

- Create: `src/lib/turn/departmentProgramSettlement.integration.test.ts`
- Modify: `src/app/api/cron/turn/fullTurnFlow.integration.test.ts`
- Test: `src/lib/budget/federalBudgetTurnCoherence.test.ts`

- [ ] Seed a minimal US budget, population, active law, legislation type, state metrics, and game state.
- [ ] Run `treasuryTurn -> departmentProgramSettlement -> policyEffects` in production order.
- [ ] Assert the treasury reflects the healthcare expense once.
- [ ] Assert the department accrues the matching authority once.
- [ ] Assert a replayed turn does not accrue or apply outcome again.
- [ ] Race two settlement attempts from the same opening snapshot; one guarded write wins and the other recomputes or no-ops.
- [ ] Assert the turn log includes phase duration, round trips, authority, outlays, and reconciliation status.
- [ ] Assert flag-off performs no account write and preserves the previous full-turn result.

**Exit:** The production shell, not only the pure rules, proves order, idempotency, and one-charge accounting.

### Task 11: Deterministic headless simulation

**Files:**

- Create: `scripts/sim/publicHealthVerticalSlice2026-09-20.ts`
- Create: `scripts/sim/reports/public-health-vertical-slice.json`
- Create: `scripts/sim/reports/public-health-vertical-slice.md`
- Test: `scripts/sim/publicHealthVerticalSlice2026-09-20.test.ts`

The simulation is pure and does not connect to Mongo.

- [ ] Run all seven matrix cases for enough turns to show ramp-up and repeal wind-down.
- [ ] Emit stable JSON with inputs, per-turn account flows, ratios, status, outcome contribution, and invariant results.
- [ ] Render the Markdown report from that JSON so prose cannot drift from measurements.
- [ ] Include a flag-off baseline comparison.
- [ ] Include sensitivity sweeps for funding and capacity separately. Report mechanics; do not characterize the policy as good, bad, left, or right.
- [ ] Fail the script on any invariant breach or unstable output ordering.
- [ ] Snapshot the expected JSON or hash it in the test so server/harness drift is visible.

Run:

```powershell
npx tsx scripts/sim/publicHealthVerticalSlice2026-09-20.ts
npx vitest run scripts/sim/publicHealthVerticalSlice2026-09-20.test.ts
```

**Exit:** The required balance report exists and is reproducible without a database.

### Task 12: Isolated `MONGODB_URI` test-world verification

**Files:**

- Create: `scripts/sim/publicHealthVerticalSliceDb2026-09-20.ts`
- Create: `scripts/sim/publicHealthVerticalSliceDb2026-09-20.test.ts`
- Append results: `scripts/sim/reports/public-health-vertical-slice.md`

**Safety contract:**

- The script reads only `MONGODB_URI`; it never falls back to `MONGODB_URI_LIVE`.
- It aborts when `MONGODB_URI` is absent.
- It aborts when normalized `MONGODB_URI` equals normalized `MONGODB_URI_LIVE`.
- It never prints either URI.
- It creates a uniquely named database with prefix `ahd_public_health_slice_test_` and writes only there.
- It refuses cleanup unless the resolved database name begins with that exact prefix.
- It seeds synthetic documents only. It does not copy player data.
- It requires `--run` before creating the fixture database.
- It records the fixture database name, document counts, and invariant summary, not connection details.

Test sequence:

1. Connect to the server named by `MONGODB_URI` with a bounded selection timeout.
2. Create the isolated fixture database.
3. Seed the smallest viable US world documents for the phase.
4. Run the same settlement entry point used by the production turn.
5. Read the before and after budget, account, program, metric, and turn-log state.
6. Assert exact reconciliation and the expected outcome contribution.
7. Run the same turn again and assert byte-equivalent state.
8. Exercise officeholder turnover and repeal with an encumbrance.
9. Confirm the URI's default database received no writes from the script.
10. Drop only the uniquely prefixed fixture database in `finally`, unless `--keep-fixture` was explicitly supplied for inspection.

Run from the worktree, loading the repository's ignored `.env.local` without copying or displaying it:

```powershell
npx tsx scripts/sim/publicHealthVerticalSliceDb2026-09-20.ts --run
```

If server selection times out, record the run as blocked infrastructure evidence. Do not substitute the live URI, weaken the guards, or claim the database criterion passed.

The planning-time read-only probe of `MONGODB_URI` timed out after 10 seconds and made no writes. Task 12 therefore remains an unverified implementation gate, not assumed available infrastructure.

**Exit:** The test-server report contains a successful isolated-world run or an explicit unresolved blocker. Gate 1 cannot choose `generalize` while this criterion is unresolved.

### Task 13: Performance and projection evidence

**Files:**

- Modify from measured evidence only: `src/simulation/engine/turnPhaseBudgets.ts`
- Modify if needed: `src/simulation/engine/turnReadProjections.test.ts`
- Append results: `scripts/sim/reports/public-health-vertical-slice.md`

- [ ] Run the focused test suite first.
- [ ] Run one local turn with round-trip profiling before and after enabling the slice.
- [ ] Record bytes, documents, and round trips for `departmentProgramSettlement` and any changed `policyEffects` reads.
- [ ] Use the collection call-site tracer if any new query appears inside a state or program loop.
- [ ] Confirm `legislationTypes` is projected.
- [ ] Confirm the shell performs no query per state, program, or department.
- [ ] Set or adjust the phase round-trip budget only from the measurement.

Commands:

```powershell
$env:AHD_TURN_ROUNDTRIP_PROFILE='1'
npx tsx scripts/perf/one-turn.ts
$env:TRACE_COLLECTIONS='federalBudget,legislationTypes,enactedLaws,statePolicies,stateMetrics'
npx tsx scripts/perf/trace-callsites.ts
```

Remove the temporary environment values after the measurements.

**Exit:** The report states the measured cost and the approved budget. No N+1 or unprojected fat read is introduced.

## 10. Implementation order and commits

The order is intentional. Do not build UI before the account and outcome path reconcile end to end.

1. Issue and characterization baseline.
2. Pure reconciliation, appropriation, priority, capacity, implementation, and repeal rules.
3. Flag and inert catalog metadata.
4. Department definition, embedded account, and guarded persistence.
5. Turn shell and telemetry.
6. Delivered-outcome cutover and attribution.
7. Read-only API and minimal office panel.
8. Unit/property suite and turn integration.
9. Pure deterministic simulation report.
10. Isolated `MONGODB_URI` test-world run.
11. Performance measurements, full verification, self-audit, and Gate 1 review.

Suggested focused commit boundaries:

```text
feat(government-finance): add portable department settlement rules
feat(legislation): add the public-health department slice behind a flag
feat(turn): settle the public-health program account once per turn
feat(metrics): scale public-health law effects by delivered implementation
feat(cabinet): show public-health program delivery in the health office
test(sim): add public-health vertical-slice evidence
```

These are implementation suggestions, not commands to commit automatically.

## 11. Verification commands

Run focused checks while implementing:

```powershell
npx vitest run src/lib/governmentFinance
npx vitest run src/lib/turn/departmentProgramSettlement.test.ts src/lib/turn/departmentProgramSettlement.integration.test.ts
npx vitest run src/lib/policyEffects.departmentDelivery.test.ts
npx vitest run src/app/api/country/[code]/executive/cabinet/[positionId]/department-programs/route.test.ts
npx vitest run src/app/country/[code]/executive/cabinet/[positionId]/office/components/DepartmentProgramPanel.test.tsx
npx tsx scripts/sim/publicHealthVerticalSlice2026-09-20.ts
npx vitest run scripts/sim/publicHealthVerticalSlice2026-09-20.test.ts
npx tsx scripts/sim/publicHealthVerticalSliceDb2026-09-20.ts --run
```

Run the repository gates before handoff:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run verify
npm run verify:build
```

Also run:

```powershell
git diff --check
rg -n "publicHealthPreparedness" src scripts
rg -n "departmentProgramSliceEnabled" src scripts
```

The final source inventory must show one delivered-law path for the migrated option and preserved independent contributors.

## 12. Acceptance criteria and Gate 1

The slice passes only when every item below has evidence in `scripts/sim/reports/public-health-vertical-slice.md`:

1. National spending, department accrual, available funds, encumbrances, outlays, and arrears reconcile exactly for every fixture.
2. Repeating settlement for the same turn is idempotent in both pure rules and Mongo integration.
3. Funding and capacity shortfalls are separately observable and produce different explanations.
4. `public_health_opt_1` changes preparedness only through the delivered implementation multiplier while the flag is on.
5. Repeal preserves valid obligations and produces deterministic wind-down.
6. Replacing the Health Secretary does not move, duplicate, erase, or reinitialize the account.
7. The minimal UI explains authority, money state, capacity state, delivery, and the resulting outcome contribution.
8. The turn shell and headless harness serialize byte-for-byte equivalent settlements from the same input.
9. The phase has measured projected reads and stays within its evidence-backed round-trip budget.
10. The `MONGODB_URI` run uses an isolated synthetic fixture database, records before/after reconciliation, and leaves the URI's default database unchanged.
11. Flag-off behavior matches the current fiscal and outcome baseline.

The report then records one decision:

- `generalize`: all criteria pass and reviewers accept the model and storage choice.
- `revise_and_rerun`: the proof is promising but one or more foundational rules, storage decisions, or explanations need another slice iteration.
- `stop`: do not generalize the architecture; retain only separately useful findings.

No UK/JP work, general department migration, regional funding work, metric consolidation, or AI allocation behavior begins before this decision is recorded.

## 13. Self-audit checklist

Before presenting the implementation PR for Gate 1, verify:

- [ ] Every rules file is synchronous, plain-data, and portable.
- [ ] No rules file imports Mongo, environment variables, the wall clock, network clients, Sentry, or `@/app`.
- [ ] The new schema is optional and flag-off compatible.
- [ ] No absent-account heal creates funding.
- [ ] The treasury is charged once.
- [ ] Currency arithmetic reconciles exactly.
- [ ] The turn path has no per-state, per-law, or per-department query.
- [ ] `legislationTypes` reads are projected.
- [ ] The migrated option has exactly one law-effect path.
- [ ] Other preparedness contributors remain functional and attributable.
- [ ] Officeholder turnover leaves the durable institution intact.
- [ ] Repeal and replay are deterministic.
- [ ] The UI does not imply that authorization guarantees delivery.
- [ ] The simulation report distinguishes illustrative fixture constants from proposed production balance.
- [ ] The database script cannot target `MONGODB_URI_LIVE`, cannot leak connection strings, and can drop only its unique prefixed fixture database.
- [ ] The affected issue is updated with tests, simulation evidence, remaining criteria, and the Gate 1 decision.

## 14. Neutral institutional references

- Congressional Research Service, *Overview of the Authorization-Appropriations Process*: authorization may establish or continue an agency, program, or activity; appropriation provides budget authority. <https://www.congress.gov/crs_external_products/RS/PDF/RS20371/RS20371.13.pdf>
- U.S. Government Accountability Office, *Principles of Federal Appropriations Law (The Red Book)*: reference material on appropriation availability and obligations. <https://www.gao.gov/legal/appropriations-law/red-book>
- U.S. Department of Health and Human Services, *About HHS*: official description of the department and its public-health and human-services mission. <https://www.hhs.gov/about/index.html>
