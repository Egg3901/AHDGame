# Issue #963 Cold War tension simulation

Date: 2026-08-27

Command:

```bash
npx tsx scripts/sim/coldWarTensionBalance.ts
```

## Method

The deterministic probe runs five standing-pressure scenarios through the
production tension formula for 24 turns, starting from the live 20.5 reading.
It also evaluates every possible roll on each tension-gated event's safe
fallback option. Event frequency uses the midpoint of its authored scheduling
window and reports expected offers per 100 continuously eligible turns per
country.

## Tension results

| Scenario                                   | Floor | Band    | First turn | Turn 24 |
| ------------------------------------------ | ----: | ------- | ---------: | ------: |
| Quiet                                      |  12.0 | DETENTE |       19.8 |    13.2 |
| Vietnam rung 1                             |  16.0 | CALM    |       20.1 |    16.6 |
| Conventional war, intensity 70             |  20.4 | CALM    |       20.5 |    20.5 |
| Two one-warhead powers at war, intensity 1 |  61.7 | CRISIS  |       61.7 |    61.7 |
| Live Germany conditions                    |  94.0 | BRINK   |       94.0 |    94.0 |

Live Germany conditions are Vietnam rung 1, six active crises, 1,214 total
warheads, and one intensity-70 war with nuclear-armed countries on opposing
sides. The result corrects the live contradiction without changing Vietnam's
independent contribution. A low-intensity nuclear war cannot read below
CRISIS. A conventional war still contributes proportionally and does not gain
the nuclear minimum.

The first turn enforces a newly higher floor immediately. Cooling above a
floor retains the existing 8 percent relaxation rate.

## Society-event exposure

| Event               | Minimum tension | Mean gap | Offers per 100 eligible turns | Safe fallback   | Expected approval | Treasury anchor | Demand turn-percent |
| ------------------- | --------------: | -------: | ----------------------------: | --------------- | ----------------: | --------------: | ------------------: |
| Panic Buying        |              60 |       17 |                          5.88 | Appeal for calm |             -0.60 |               0 |               38.40 |
| Run on the Banks    |              65 |       24 |                          4.17 | Stand by        |             -1.40 |               0 |              -35.80 |
| Civil Defense Fever |              50 |       20 |                          5.00 | Drills          |              1.00 |               0 |               18.00 |
| War Scare Protests  |              60 |       16 |                          6.25 | Let them march  |             -2.00 |               0 |                0.00 |

Demand turn-percent is sector-demand percentage multiplied by duration and
roll probability. It is an exposure comparison, not a claim that demand and
duration are interchangeable.

All safe fallbacks are treasury neutral. Across 100 continuously high-tension
turns, the four event types produce about 21 offers per country before pending
event constraints. This is intentionally recurring, but bounded by independent
10 to 32 turn cooldown windows and the one-pending-event rule.

## Decision

Accept the constants for issue #963 and issue #965. The nuclear minimum matches
the required CRISIS invariant. The live multi-crisis, large-arsenal war reaches
BRINK, which is appropriate while nuclear-armed coalitions are fighting
directly. The domestic-event defaults create visible pressure without automatic
treasury losses.
