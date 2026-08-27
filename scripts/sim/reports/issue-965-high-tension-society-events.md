# Issue #965 high-tension society event simulation

Date: 2026-08-27

Command:

```bash
npx tsx scripts/sim/highTensionSocietyEvents.ts
```

## Method

The deterministic probe evaluates every possible roll on each event's safe
fallback option. The rate column is the independent steady-state rate implied
by each authored scheduling window midpoint. It does not model initial
eligibility, competition among definitions, country hashes, pending events, or
the scheduler's one-offer-per-turn rule.

## Results

| Event               | Minimum tension | Mean gap | Steady-state rate per 100 eligible turns | Safe fallback   | Expected approval | Treasury anchor | Demand turn-percent |
| ------------------- | --------------: | -------: | ---------------------------------------: | --------------- | ----------------: | --------------: | ------------------: |
| Panic Buying        |              60 |       17 |                                     5.88 | Appeal for calm |             -0.60 |               0 |               38.40 |
| Run on the Banks    |              65 |       24 |                                     4.17 | Stand by        |             -1.40 |               0 |              -35.80 |
| Civil Defense Fever |              50 |       20 |                                     5.00 | Drills          |              1.00 |               0 |               18.00 |
| War Scare Protests  |              60 |       16 |                                     6.25 | Let them march  |             -2.00 |               0 |                0.00 |

Demand turn-percent is sector-demand percentage multiplied by duration and
roll probability. It is an exposure comparison, not a claim that demand and
duration are interchangeable.

All safe fallbacks are treasury neutral. The four independent steady-state
rates sum to about 21 per 100 eligible turns. That sum is a balance comparison,
not a forecast of actual offers. Independent 10 to 32 turn cooldown windows,
definition competition, and the one-pending-event rule further shape live
exposure.

## Decision

Accept the constants for issue #965. The fallback choices create visible
domestic pressure without automatic treasury losses, while the tension gates
prevent these events from appearing in a calm world.
