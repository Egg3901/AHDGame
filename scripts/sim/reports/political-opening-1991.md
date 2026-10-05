# 1991 political opening qualification

Issues #3266, #3267, #3268, #3269. Reproduce with `npx tsx scripts/sim/politicalOpening1991.ts`.
This is a portable component qualification of the actual v1 approval, law target,
residual and macro drift rules. It does not claim a full-world turn simulation.

The authored national boards distinguish service capacity, governance and defense
from temporary economic conditions. US/UK texture comes from committed 1991 regional
sources and is centered by population before proportional scaling to +/-12.
US uses only explicit 1991 preset cells because its legacy bundle jitters at import.
Shared US profiles reflect its 15 authored regional profiles; all 51 states are covered.
UK has 12 distinct profiles. Defense remains national. Rounding permits at most 0.05
points of national-mean error. Russia's transition profile has a 43 political base,
compared with 52 US and 48 UK, before conditions and public expectations.

| Country | Regions | National opening approval | Regional approval range | 48-turn macro-only approval | 48-turn engine-bound stress range |
| ------- | ------: | ------------------------: | ----------------------- | --------------------------: | --------------------------------- |
| US      |      51 |                      50.7 | 43.2 to 59.3            |                       50.77 | 47.06 to 54.50                    |
| UK      |      12 |                      43.2 | 44.7 to 51.3            |                       43.29 | 39.59 to 47.03                    |
| JP      |       8 |                      42.2 | 44.5 to 48.5            |                       42.24 | 38.56 to 45.78                    |

All 71 player regions have 63 finite scores in 0..100. Seeded structural residuals
compose exactly to the seeded board for every family, with zero equilibrium error.
The largest per-turn movement under the bounded engine stresses is 0.48 board points.
One primary-law level changes the worker-security target by 12.5 points; its48-turn
national approval response is about 0.05 to 0.06 points because approval averages 63
families. This report qualifies that existing responsiveness; it does not change
approval or drift coefficients.

Assumptions: neutral electorate, fixed macro observations, no cabinet/labour/conflict
or event offsets. The engine stress applies its entire +/-12 bound uniformly to
every family, rather than pretending to reproduce funded engine inputs. JP retains
its already-authored derived board and legacy law path. The separate Japan macro
anchor mismatch is tracked in issue #3262 and is not silently rewritten here.

The repair carries each region's existing change from the old 1979 opening into the
new opening. Its residual changes by the same actual score delta, preserving its
previous distance from the law target, including clipping at 0/100. Existing enacted
laws, budgets and histories remain intact. New worlds use the explicit 1991 program
level anchors. Version stamps make the repair idempotent. Stale embedded runtime
effects are removed only by the separately guarded opening-world cleanup.
