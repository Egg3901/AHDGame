# Playable-region 1953 texture: balance report (issue #704)

Issue #704. Reproduce: `npx tsx scripts/sim/playable-region-texture-1953.ts`.
The script is deterministic and offline (committed seeds in, plain numbers
out, no database, no clock, no randomness) and throws on any violation, so a
green run IS the check. Output below is the captured stdout of that script.

Deterministic offline analysis over every playable region and family.
Regenerate: `npx tsx scripts/sim/playable-region-texture-1953.ts`.

## Coverage

- US: 51 regions, 51 textured families, 2560 cells, defense cells 0
- UK: 12 regions, 48 textured families, 555 cells, defense cells 0
- RU: 14 regions, 16 textured families, 201 cells, defense cells 0
- DD: 6 regions, 16 textured families, 82 cells, defense cells 0
  Defense is absent everywhere (national posture, no regional signal).

## Attorney General portfolio spread (US, texture deviations)

| family               | distinct values |  min | max |
| -------------------- | --------------: | ---: | --: |
| order.safety         |              30 | -2.3 | 4.1 |
| order.courts         |              37 |   -6 |   4 |
| order.communityTrust |               5 |  -12 | 5.6 |
| order.policeStrength |              31 | -2.9 | 2.7 |
| order.deterrence     |              37 |   -6 |   4 |
| order.dueProcess     |              34 |   -6 | 3.7 |
| order.legalAid       |              37 |   -6 |   4 |

Before: every US region's order.safety residual was 51.5 (byte-identical).
After: 30 distinct deviations spanning -2.3 to +4.1 on top of the baseline.

## Country mean preservation (population-weighted mean per family)

- US: max |weighted mean| 0.0409
- UK: max |weighted mean| 0.0424
- RU: max |weighted mean| 0.0444
- DD: max |weighted mean| 0.0202
  Worst drift 0.0444 is rounding dust (1-decimal emission).

## Hand-modifier exactness

- 130 hand-authored cells, 0 texture overlaps
- Mississippi society.integration modifier is exactly -18, texture absent there.
  Seeder applies modifier ?? texture, so a modifier cell is baseline + modifier exactly.

## Seeded clamp slippage

- 3528 seeded region-family cells, 0 clamp at 0/100
  The +/-12 texture never pushes a seeded value outside 0-100: no clipping, no lost variation.

## Southern US bound saturation

- US: 64/2560 cells at exactly +/-12 (2.5%)
- South (AL,AR,GA,LA,MS,NC,SC,TN,VA): 58/439 (13.2%)
- US order.communityTrust: 5 distinct values (coarsest family)

Verdict: scaling preserves every ratio the legacy seeds provide, so the
-12 ties (AL/AR on education.attainment) are genuinely identical legacy
inputs, not algorithm flattening. Clamping would have collapsed one tail;
scaling keeps the full ordering. The coarsest family (communityTrust, 5
bands) inherits coarse legacy bands; inventing finer noise there would be
fabrication, not texture. No algorithm change.

All assertions passed.
