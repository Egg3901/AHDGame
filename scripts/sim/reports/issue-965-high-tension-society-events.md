# Issue #965 high-tension society event simulation

Date: 2026-08-27

Command:

```bash
npx tsx scripts/sim/highTensionSocietyEvents.ts
```

## Method

The deterministic probe evaluates every possible roll on each event's safe
fallback option. Frequency uses the midpoint of the authored scheduling window
and reports expected offers per 100 continuously eligible turns per country.

## Results

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
event constraints. Independent 10 to 32 turn cooldown windows and the
one-pending-event rule bound the recurring exposure.

## Decision

Accept the constants for issue #965. The fallback choices create visible
domestic pressure without automatic treasury losses, while the tension gates
prevent these events from appearing in a calm world.
