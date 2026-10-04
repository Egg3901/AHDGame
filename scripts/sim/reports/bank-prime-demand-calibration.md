# Household bank credit demand calibration

This change makes the volume reference prime plus 2 percentage points. Two worlds with the same loan spread now produce the same per-band origination targets. Existing loans retain their stored rates and expected defaults.

The deterministic `scripts/sim/bankViabilityModel.ts` uses the real shared rules over 480 turns with 10 million starting equity, a 20% reserve requirement, balanced lending and deposit/lending offsets of -1.75/+4.125. It excludes bond inventory, named borrowers and the failure resolver. Its results diagnose demand; they do not establish full-world acceptance.

| Prime  | Equity remaining | Loans/deposits | Final annual income / initial equity |
| ------ | ---------------: | -------------: | -----------------------------------: |
| 5.75%  |        5,968,013 |          0.448 |                               -2.18% |
| 8.50%  |          989,185 |          0.448 |                               -2.17% |
| 12.00% |           99,572 |          0.448 |                               -0.45% |

The stable loan/deposit ratio confirms that nominal prime no longer throttles demand by itself. The losses confirm that prime-based demand alone does not meet the neutral 8 to 15% ROE target. Funded government-bond investment and fee calibration remain necessary in #3071.

The 1991 preset already selects modern deposit and lending corridors. A regression test now checks the actual resolver for that preset.

Paired full-world sandbox qualification is pending. This calibration slice remains a draft until that evidence is available.
