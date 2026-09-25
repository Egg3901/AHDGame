# Issue #2325: 2027 regional population overlay

The 2027 fiscal seeds carry national population anchors while ten countries still
use older regional totals. This diagnostic overlay preserves each existing
region's share and apportions integer residents to the fiscal anchor. These
regional shares are **proxies** until individually sourced modern bundles replace
them. It applies only to `2027-default`.

| Country |        Before | National anchor |         After |
| ------- | ------------: | --------------: | ------------: |
| IE      |     4,740,000 |       5,100,000 |     5,100,000 |
| CN      | 1,238,000,000 |   1,412,000,000 | 1,412,000,000 |
| NG      |   190,200,000 |     200,000,000 |   200,000,000 |
| FR      |    53,300,000 |      67,000,000 |    67,000,000 |
| IT      |    55,900,000 |      60,400,000 |    60,400,000 |
| ES      |    37,000,000 |      47,000,000 |    47,000,000 |
| SE      |     8,300,000 |      10,300,000 |    10,300,000 |
| GR      |     9,500,000 |      10,700,000 |    10,700,000 |
| AT      |     7,550,000 |       8,900,000 |     8,900,000 |
| FI      |     4,770,000 |       5,500,000 |     5,500,000 |

Fresh bootstrap conformance on the pinned short-run sandbox changed from 425
ok / 52 warnings / 0 critical to 460 ok / 6 warnings / 0 critical. All ten
population checks became `ok`. The remaining six warnings were unrelated
readiness and reset-metadata checks, corrected in the following source revision.

The four-turn full-flags probe `038bc511-167a-4c60-a9c3-ae4eb2fa0637`
completed, with plants market, v5 NPP autonomy, active freight and the explicit
liquidity/sourcing flags. At turn 4, its health snapshot had zero errors and two
warnings from checks that counted future Irish elections and playerless parties.
Re-evaluating that sandbox with the corrected health logic at turn 5 produced
zero warnings and zero errors. The turn-4 checkpoint chart is
`/tmp/worldsim-2027-population-overlay-probe.html` on the simulation host.

This four-turn result checks bootstrap and immediate runtime only. It does not
establish long-horizon demographic or economic balance. Do not merge the proxy
as final regional history without replacing its shares with sourced modern data.
