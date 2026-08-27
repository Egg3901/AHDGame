# Issue #963 Cold War tension simulation

Date: 2026-08-27

Command:

```bash
npx tsx scripts/sim/coldWarTensionBalance.ts
```

## Method

The deterministic probe runs five standing-pressure scenarios through the
production tension formula for 24 turns, starting from the live 20.5 reading.

## Results

| Scenario                                   | Floor | Band    | First turn | Turn 24 |
| ------------------------------------------ | ----: | ------- | ---------: | ------: |
| Quiet                                      |  12.0 | DETENTE |       19.8 |    13.2 |
| Vietnam rung 1                             |  16.0 | CALM    |       20.1 |    16.6 |
| Conventional war, intensity 70             |  20.4 | CALM    |       20.5 |    20.5 |
| Two one-warhead powers at war, intensity 1 |  61.8 | CRISIS  |       61.8 |    61.8 |
| Live Germany conditions                    | 100.0 | BRINK   |      100.0 |   100.0 |

Live Germany conditions are Vietnam rung 1, six active crises, 1,214 total
warheads, and one intensity-70 war with nuclear-armed countries on opposing
sides. The result corrects the live contradiction without changing Vietnam's
independent contribution. A low-intensity nuclear war cannot read below
CRISIS. A conventional war still contributes proportionally and does not gain
the nuclear minimum.

The first turn enforces a newly higher floor immediately. Cooling above a
floor retains the existing 8 percent relaxation rate.

## Decision

Accept the constants for issue #963. The nuclear minimum matches the required
CRISIS invariant. The live multi-crisis, large-arsenal war reaches the top of
BRINK, which is appropriate while nuclear-armed coalitions are fighting
directly. Intensity remains additive above the nuclear-war minimum.
