# Demographics v2 Method 4 sensitivity report

Issue context: #2159. This deterministic report exercises the portable rules added for the first Method 4 slice. It compares today's fixed structural turnout with v2 participation and verifies that the live population stock changes electorate age composition.

Command:

`npx tsx scripts/sim/demographics-v2-method4.ts`

| Scenario                 | Pack  | v1 turnout | v2 turnout |   Delta | Contact | Fatigue | Econ weight | Social weight |
| ------------------------ | ----- | ---------: | ---------: | ------: | ------: | ------: | ----------: | ------------: |
| Quiet safe race          | US-v1 |      54.0% |      52.0% | -2.0 pp |  0.0 pp |  0.0 pp |       0.925 |         0.850 |
| Close high-contrast race | US-v1 |      54.0% |      61.9% |  7.9 pp |  4.0 pp | -1.0 pp |       1.150 |         1.150 |
| Close low-contrast race  | US-v1 |      45.0% |      47.4% |  2.4 pp |  2.0 pp | -0.3 pp |       0.925 |         0.925 |

The synthetic live vector contains 20% young, 25% mid, 25% mature, and 30% senior eligible residents. Demographics v2 reproduces those four shares from the canonical age-by-sex population stock. V1 continues to use the seed-era census marginal.

## Interpretation

- A safe, low-contrast contest loses 2.0 percentage points relative to v1 after both paths apply the same registered-voter gate. This makes low-energy elections visibly different without overriding the existing demographic habit rate.
- A close, high-contrast contest with a four-point contact lift gains 7.9 points. Repeated contact returns one point through fatigue, so canvassing remains useful without scaling forever.
- A close but low-contrast contest with lighter contact gains 2.4 points because competition and contact narrowly exceed low salience and fatigue.
- Axis weights stay within 0.85 to 1.15, so issue contrast changes candidate fit without replacing the existing ideology scale.

## Guardrails

- The V1 behavior path is unchanged because no v2 input is passed unless the reset-scoped Demographics receipt is valid for the current world and country.
- Final turnout is clamped to 15% to 95%.
- The registered-voter share is applied exactly once. V2 records the resulting percentage-point reduction as ballot access; v1 keeps the same existing ballot gate for a like-for-like comparison.
- Calibration is selected by country and named in the receipt. Every supported country has a v1 pack; US, UK, and Japan begin with explicit overrides, and unknown country ids use the `global-v1` fallback.
- Campaign contact is written as its own exactly-once canvassing ledger and decays with the modern campaign snapshot. No additional turn-path read is required.
- Every v2 tally snapshot stores the electorate-weighted participation receipt used by the player-facing explanation and Campaign Room guidance.
- Live age marginals fall back to the existing census data if the vector is absent or empty.
- The turn path adds one projected, country-batched `regionDemographics` read only when Demographics v2 is active. It does not query per election or per region.

## Existing-world migration preflight

On 2026-10-07, the held migration was dry-run against `MONGODB_URI_LIVE` through the Railway direct-connection path. The current world was active, had a stable reset identity and valid turn, and every populated US, UK, JP, and inactive IE region had a complete, non-negative 101-element male and female age vector with a valid update time. Ireland had eight state rows and eight matching vectors. Scotland and Wales remain deferred because their sovereign sub-regions and vectors are created during independence expansion, immediately before the existing promotion hook verifies them and adds them to the receipt. The migration reported zero updated documents. Dry-run did not install a receipt, change a gate, or write a migration marker.
