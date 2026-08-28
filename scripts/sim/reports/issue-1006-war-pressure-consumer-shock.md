# Issue #1006 war pressure and consumer shock simulation

Date: 2026-08-28

Command:

```bash
npx tsx scripts/sim/warPressureConsumerShock.ts
```

## Method

The deterministic probe runs Vietnam's production phase transition function
with the live Germany-war shape: global tension 100, conflict intensity 70,
the United States on one side, the Soviet Union on the other, and Germany as
the theater. It compares that with tension 100 but no open superpower war and
checks the 1964 historical gate separately.

For Civil Defense Fever, the probe reads the production crisis template and
the funded-shelter response directly. It applies the onset margin shock to the
reported 90-point example margin and reports each output-demand shift as its
percentage multiplied by duration.

## Vietnam results

| Scenario                                    | Year | Turns | External pressure per turn | Final rung | Stored pressure |
| ------------------------------------------- | ---: | ----: | -------------------------: | ---------: | --------------: |
| Tension 100, no superpower war              | 1961 |     6 |                          0 |          1 |               0 |
| Germany war from zero pressure              | 1961 |     6 |                          4 |          2 |               0 |
| Live threshold state                        | 1961 |     1 |                          4 |          2 |               4 |
| Germany war for 20 turns before Tonkin year | 1961 |    20 |                          4 |          2 |              24 |
| Full threshold when Tonkin year arrives     | 1964 |     1 |                          4 |          3 |               4 |

The live state advances from advisors to materiel on the first turn after
deployment. Continued pressure fills the next threshold but cannot enter the
Tonkin rung before 1964. High tension by itself does not move Vietnam unless a
high-intensity US-Soviet war is active.

## Civil Defense Fever results

The ambient retail shock is 18 margin points over a 12-turn crisis, fading
linearly from full strength. A sector at a 90-point margin therefore reads 72
at onset rather than 87.

| Funded shelter response | Output-demand shift | Duration | Turn-percent exposure |
| ----------------------- | ------------------: | -------: | --------------------: |
| Retail                  |                -20% |       12 |                  -240 |
| Entertainment           |                -12% |       12 |                  -144 |
| Construction            |                +20% |       12 |                  +240 |
| Manufacturing           |                +20% |       12 |                  +240 |
| Defense                 |                +20% |       12 |                  +240 |

The 20% values reach the existing per-country, per-sector stacking cap. They
cannot compound beyond that cap when several wartime modifiers overlap.

## Decision

Accept the constants. Germany's current war produces immediate Vietnam
movement without bypassing the calendar ceiling. Civil Defense Fever becomes
a visible consumer contraction and wartime reallocation while remaining
bounded by the existing demand-modifier cap and the crisis decay curve.
