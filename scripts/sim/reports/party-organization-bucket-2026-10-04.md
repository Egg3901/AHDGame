# Party organization bucket balance report

## Configuration

- Each successful Build Org click contributes exactly 1 organization unit.
- Every region permanently includes 100 non-decaying Unaffiliated units.
- Existing percentage-only rows bootstrap at a regional scale that preserves
  their displayed shares where possible, capped at 10 units per percentage
  point near a fully allocated legacy region.
- Percentages use `party units / (100 Unaffiliated units + all party units)`.
- Decay begins once inactivity reaches 96 turns, at 1.00% of units per turn.
- A successful click adds its unit and resets that party's inactivity clock.

## Fresh-party pacing

The deterministic probe starts from a legacy 80% incumbent, a legacy 20% rival, and a fresh party at zero. Because the old region was fully allocated, compatibility bootstrap uses the capped scale of 10 units per old percentage point: 800 incumbent units and 200 rival units.

| Fresh clicks | Fresh Org% | Incumbent Org% |
| -----------: | ---------: | -------------: |
|            1 |      0.09% |         72.66% |
|           25 |      2.22% |         71.11% |
|           80 |      6.78% |         67.80% |
|          200 |     15.38% |         61.54% |
|          400 |     26.67% |         53.33% |
|          800 |     42.11% |         42.11% |
|          801 |     42.14% |         42.08% |

A fresh party needs 800 equal contributions merely to draw level with the bootstrapped incumbent and 801 to pass it. This is intentionally much slower than the earlier no-reserve model and directly prevents a few late clicks from erasing a long-running investment lead. Regions whose legacy party total is below 90% use a smaller exact-preservation scale, so their inherited balances are less entrenched.

## Major and minor party thresholds

The tier system earns a region at 20% Org and retains an already-earned region down to 10% Org. The permanent stake changes how much investment reaches that absolute threshold:

| Scenario                                       | Clicks to at least 20% | Resulting Org% |
| ---------------------------------------------- | ---------------------: | -------------: |
| Empty region, fresh party                      |                     25 |         20.00% |
| Legacy 20% party in a fully allocated region   |                     25 |         20.00% |
| Fresh party against legacy 80% and 20% parties |                    275 |         20.00% |

A legacy party at exactly 20% in a fully allocated region initially displays about 18.18% after the capped compatibility conversion, but needs 25 additional clicks to regain the earning threshold. An already-earned region remains earned because 18.18% stays above the 10% loss threshold. A new minor party can earn an uncontested region quickly, while entering a mature fully allocated region is deliberately much harder. Election calculations that normalize organization between participating parties preserve relative legacy strength; absolute Org gates such as tier thresholds still see the permanent Unaffiliated stake.

## Decay pacing

The decay probe starts a stale party at 800 units and holds a 200-unit comparison party constant to isolate inactivity loss.

| Turns decaying | Stale units | Stale Org% |
| -------------: | ----------: | ---------: |
|              1 |      792.00 |     72.53% |
|             24 |      628.54 |     67.69% |
|             69 |      399.87 |     57.13% |
|             96 |      304.84 |     50.40% |
|            168 |      147.84 |     33.01% |

There is no loss during the first 95 inactive turns. Decay begins on turn 96 of inactivity, and the selected rate has an approximately 69-turn half-life. A returning party's next click adds one unit and immediately resets the grace clock.

## Assessment

The fixed unit makes every landed click mechanically equal while preserving the existing PS pressure ladder and treasury charge. The permanent 100-unit Unaffiliated stake prevents the parties from collectively reaching 100% and absorbs part of every inactive party's lost share instead of automatically transferring all of it to competitors. Compatibility conversion preserves legacy shares exactly when the old party total is at most 90%; a fully allocated region retains about 90.9% combined party Org, preserving relative party strength while making Unaffiliated permanent. The capped conversion makes a cold challenge to a heavily established legacy party a long project. The chosen grace and decay rate preserve a four-day absence while making continued inactivity consequential within several days.

Generated with `npx tsx scripts/sim/partyOrganizationBucket2026-10-04.ts`.
