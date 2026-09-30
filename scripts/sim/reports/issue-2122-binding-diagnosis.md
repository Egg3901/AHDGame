# NPP corporation binding-gate diagnosis (#2122)

## Finding

NPP corporations face different entry constraints by sector. In the retained 1991 window, retail and chemicals most often encounter the market-entry cohort gate; extraction most often encounters its strategy gate. Independently, the growth-affordability governor is the first internal decision constraint in 75-85% of these sectors' observations. It reduces target growth when the growth bill consumes at least half the sector margin. Raising growth or discretionary budgets indiscriminately would work against that cash protection.

The first constraint is an explanation of an observed decision, not proof that this gate caused every negative-cash outcome. Gate counts include healthy and distressed corporations. The fielded task asks for a published diagnosis and worldsim regression metric; both are provided below.

## Provenance and sampling

- Run: `24fa81d5-db2d-4349-8cc0-145e1e99dd73`, preset `1991-default`.
- Executed game source: `47bb364e1f605c895d186e51f6a19b6ed4de5ff3`.
- Completed sampled turns: 233-279 (47 consecutive turns). The parent run was still running; this is a completed interval, not a claim that the entire run finished.
- Operator schema: 2. Corporation cohort: 547 corporations classified by NPP leadership and primary sector at extraction. Per-turn history denominators vary with available rows and entry. All sampled cash values and write-time FX rates are finite.
- Decision cash is recorded after the decision's cash movements, before later turn income. Cash-history samples are taken at the corporation-history write. These are reported separately, never relabeled as the same instant or as reconstructed end-of-world cash.
- Current leader/type metadata defines the historical cash cohort. This does not reconstruct historical CEO changes or recover corporations absent from that cohort.
- [Complete per-turn regression series](issue-2122-sector-window.csv). Missing histories are missing, never zero. The collector fails on missing whole turns or duplicate corporation histories.

## Sector diagnosis

| Sector              | Decision observations | Leading market-entry gate | Gate count | First internal constraint | Count |  Share |
| ------------------- | --------------------: | ------------------------- | ---------: | ------------------------- | ----: | -----: |
| retail              |                  1175 | `cohort_ineligible`       |        486 | `growth_unaffordable`     |  1002 | 85.28% |
| chemical_industries |                  1175 | `cohort_ineligible`       |        431 | `growth_unaffordable`     |  1003 | 85.36% |
| extraction          |                  6084 | `strategy_disallowed`     |       2476 | `growth_unaffordable`     |  4555 | 74.87% |

Cash-floor entry gating also occurs in 26.30% of retail observations, 20.43% of chemicals, and 30.00% of extraction. Divestment is observed (11, 17, and 23 internal first-constraint observations respectively), so the evidence does not support an always-disabled divest path.

## Cash-negative regression metric

Definition: corporations with `liquidCapital < 0` divided by NPP-led corporations with a retained finite cash-history row, grouped by primary sector and exact raw turn. Denominators are retained in the CSV. Decision-time negative counts use their own observation denominator.

| Sector              | Cash-history cohort, first/last | Cash-negative share, first/last | Maximum share in window | Decision-time negative observations |
| ------------------- | ------------------------------: | ------------------------------: | ----------------------: | ----------------------------------: |
| retail              |                         25 / 25 |                   0.00% / 4.00% |                   8.00% |                           29 / 1175 |
| chemical_industries |                         25 / 25 |                   4.00% / 0.00% |                   8.00% |                           27 / 1175 |
| extraction          |                       128 / 129 |                   3.12% / 3.88% |                   4.69% |                          153 / 6084 |
| logistics           |                         23 / 23 |                   0.00% / 0.00% |                   0.00% |                            0 / 1115 |

The historical 1953 snapshot used another preset, source revision, and cohort. It remains evidence of that world's distress, not a matched control for this 1991 interval. This report makes no before/after causal claim and sets no new profitability target from the observed output. The truncated original "NPP vs" note supplies no additional defined comparison; vacant state-backed firms are not treated as a valid private-firm control.

## What the binding rules mean

- [`nppCorporationBehavior.ts`](../../../src/lib/turn/nppCorporationBehavior.ts) evaluates profitability using realized receipts minus actual prior overhead and debt service. Book revenue alone cannot justify a larger budget.
- The growth governor compares `currentGrowthCost / revenue` with `margin * GROWTH_COST_MARGIN_SHARE`, then reduces an unaffordable target. This explains the dominant internal constraint in the sampled sectors.
- Market entry separately applies cohort, strategy, logistics, and cash-floor checks. The coarse entry result and first internal constraint answer different questions and are not added together.
- [`rules.ts`](../../../src/lib/corporations/nppOperatorTelemetry/rules.ts) defines first-constraint precedence. [`nppCorporationHealth.ts`](../../../src/lib/economy/nppCorporationHealth.ts) is the reusable regression metric; the historical admin route returns diagnostics-only rather than mixing current cash with old decisions.

## Reproduction

Run `npx tsx scripts/sim/nppCorporationDiagnosis.mjs --db=<sandbox> --run-id=<run-id>` with explicit `SIM_MONGODB_URI` for the dedicated loopback sandbox. The script performs only projected reads and prints sanitized aggregate results. A later extraction may have a later retained window; use the committed CSV for this fixed interval.

Regression coverage exercises actual decisions for growth affordability, protected-core divestment, overhead feedback, cash rails, constraint precedence, telemetry persistence, sector cash metrics, and historical-route provenance.
