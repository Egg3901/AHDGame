# Constant-price output signal simulation

Issue #1470. Run `node --import tsx scripts/sim/realOutputGdp.ts`.

The deterministic harness runs production signal and output-gap helpers for 144 turns. Quantity and price paths are exogenous. This is an estimator regression, not full-world balance certification.

| Scenario        | Turn | Prior signal | New signal | Prior GDP growth | New GDP growth |
| --------------- | ---: | -----------: | ---------: | ---------------: | -------------: |
| flat            |   72 |            0 |          0 |            1.782 |          1.782 |
| flat            |  120 |            0 |          0 |            1.952 |          1.952 |
| price-fall      |   72 |          -10 |          0 |            -3.12 |          1.782 |
| price-fall      |  120 |       -0.428 |          0 |            7.136 |          1.952 |
| output-fall     |   72 |          -10 |        -10 |            -3.12 |          -3.12 |
| output-fall     |  120 |       -0.428 |     -0.428 |            7.136 |          7.136 |
| price-recovery  |   72 |          -10 |          0 |            -3.12 |          1.782 |
| price-recovery  |  120 |           15 |          0 |           14.796 |          1.952 |
| output-recovery |   72 |          -10 |        -10 |            -3.12 |          -3.12 |
| output-recovery |  120 |           15 |         15 |           14.796 |         14.796 |

A 20% price decline with unchanged production previously reached the -10% sector signal floor. The volume signal stays at zero. Quantity-only contractions and recoveries are unchanged, asserted every turn. The existing output-gap system still reverts headline growth toward potential; the volume signal is a cyclical input, not a replacement national-accounts identity.

## Migration and missing observations

Two optional state fields, `sectorOutputEma` and `sectorOutputSnapshots`, hold separate constant-price history. Nominal history remains intact. No new volume level is compared with a historical currency amount. The physical path begins a gradual handoff after the existing eight-turn minimum baseline and reaches full authority after 48 turns of observation. The oldest retained observation determines maturity, so nearest-year baseline selection cannot reintroduce nominal prices after the handoff. The blended sector signal feeds the existing output-gap integrator; GDP and gap state remain coherent without resets. Incomplete regional observations clear physical history and retain fallback rather than treating missing output as zero. Leaving plants mode clears both histories. No bulk repair is included.

Production is weighted at the canonical commodity basket using the effective strategy mix and fixed unit scale. Market prices and FX never enter the index. Changes in the produced basket remain consequential. Common era scale cancels within a world. Future changes to the canonical basket require deliberate history rebasing.

## Remaining validation

Coupled world tests must include demand, inventories, employment, prices, command allocation, controller behavior and recovery. This isolated result does not establish the historical cause of a particular recession or prove US recovery. It introduces no US-only growth floor or policy override.
