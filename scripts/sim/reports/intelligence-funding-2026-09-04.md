# Intelligence funding: affordability report

Date: 2026-09-04
Harness: `scripts/sim/intelligenceFunding2026-09-04.ts`
Issue: `Egg3901/AHDGame#1409`
Gates: `OP_COST_GDP_FRACTION`, `ACTION_COST_GDP_FRACTION`, `NETWORK_UPKEEP_GDP_FRACTION`

## Why this report exists

CLAUDE.md gates balance changes on a simulation report, and action costs are named
explicitly. This change replaces three flat cost constants with fractions of GDP.

Unlike the phase 3 sabotage gate, which could not be satisfied because the live world had no
front to measure, this one is measurable exactly: affordability is arithmetic over the
enacted line and the cost constants, not a sampled outcome. Every GDP below is read live
from `federalBudget`. Nothing was written.

## The defect being fixed

`federalBudget.gdp` is denominated in each country's own currency. Live, 2026-09-04:

| Country | GDP (local) |
| ------- | ----------- |
| RU      | 1.478e12    |
| US      | 5.649e11    |
| DD      | 2.905e11    |
| UK      | 2.201e10    |

Against that spread, the flat costs being replaced (75,000 a collection, 220,000 a covert
action) were not a balance dial but a currency artefact. At an identical share of GDP they
bought the UK three operations a turn and the USSR two hundred. `NETWORK_FUNDING_COST`
carried the same defect and was worse still: nothing ever charged it, so networks built for
free.

## The ladder

Costs are now fractions of the ordering country's own GDP. Because the funding line is also
a fraction of the same GDP, GDP cancels.

| Level               | Fraction of GDP | Collection ops/turn | Covert actions/turn | `steady` networks |
| ------------------- | --------------- | ------------------- | ------------------- | ----------------- |
| 0 Unfunded          | 0               | 0.00                | 0.00                | 0.00              |
| 1 Nominal Provision | 0.0005          | 1.16                | 0.39                | 0.79              |
| 2 Standing Service  | 0.0015          | 3.47                | 1.16                | 2.37              |
| 3 Expanded Service  | 0.0030          | 6.94                | 2.31                | 4.73              |
| 4 Unrestricted Vote | 0.0050          | 11.57               | 3.86                | 7.89              |

Each figure is what the level affords if the whole accrual went to that one thing.

## Result 1: GDP cancels

Collection operations affordable per turn, by country:

| Level               | RU    | US    | DD    | UK    |
| ------------------- | ----- | ----- | ----- | ----- |
| 0 Unfunded          | 0.00  | 0.00  | 0.00  | 0.00  |
| 1 Nominal Provision | 1.16  | 1.16  | 1.16  | 1.16  |
| 2 Standing Service  | 3.47  | 3.47  | 3.47  | 3.47  |
| 3 Expanded Service  | 6.94  | 6.94  | 6.94  | 6.94  |
| 4 Unrestricted Vote | 11.57 | 11.57 | 11.57 | 11.57 |

Identical to within floating point across all four countries at every level, in four
different currencies. This is the property that makes the UK and the USSR comparable at all,
and it is the whole reason for the redenomination.

## Result 2: money binds low, slots bind high

`OP_SLOTS_PER_TURN` is 2, so a service can never run more than two operations a turn however
rich it is. The question is whether money or tempo is the live constraint at each level.

| Level               | Binding constraint       | After both op slots           |
| ------------------- | ------------------------ | ----------------------------- |
| 0 Unfunded          | money                    | nothing                       |
| 1 Nominal Provision | money (affords 1.16 ops) | nothing                       |
| 2 Standing Service  | slots                    | exactly 1.00 `steady` network |
| 3 Expanded Service  | slots                    | 3.37 `steady` networks        |
| 4 Unrestricted Vote | slots                    | 6.53 `steady` networks        |

This is the intended shape and the calibration target was hit exactly:

- **Level 1 forces a choice.** A service cannot work both slots and keep a network. It buys
  reach or tempo, not both.
- **Level 2 is the design centre.** Both slots every turn plus exactly one properly funded
  network, with nothing to spare.
- **Levels 3 and 4 buy reach, not tempo.** Tempo is capped by the slots, so the surplus goes
  into networks: a global service rather than a faster one.

## Deployment impact: none

Every country's funding law is seeded at level 0 ("Unfunded"). `seedPoliticalLegislation`
writes a `statePolicies` row for every law but skips the `enactedLaws` insert at level 0, so
a level-0 law contributes no spending line, no cost and no political-metric points. With no
line there is no accrual and no pot.

`resolveIntelligenceLineFrom` deliberately does not carry the enacted → baseline → GDP
cascade that the defence line has; absent means zero. A GDP fallback would have funded every
country in the world the moment the field shipped.

So: no country's economy changes on deploy, no national accounts move, and no seeded balance
constant is being retuned. The amounts are player-chosen from turn one.

## Caveat

These are affordability figures, not outcome figures. They say what a funding level lets a
service attempt; they say nothing about how often an attempt succeeds, which is governed by
`counterIntel`, tradecraft and the resolver's rolls, and is unchanged by this work. The
question of whether operations succeed at the right rate is a separate measurement that
needs live operations to have actually been run, and none have: the feature has been
unusable since it shipped, which is what this change fixes.
