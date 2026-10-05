# Monetary reference continuity qualification, issue #2530

The reference-calibration fix is implemented in [PR #2533](https://github.com/Egg3901/AHDGame/pull/2533). It preserves the authored 1953, 1971, 1979 and 1991 anchors and the modern fallback from 1999, interpolating reference inflation, neutral rates and structural trend growth between them. Integer-year consumers advance those references annually. Actual inflation, interest-rate policy and political decisions remain separate.

## Source and execution

The existing qualification records were reconciled on 2026-10-04. No simulation was rerun for this report. Both recorded worlds used `1991-default` and seed `audit_baseline_pair_1991_0929`, advanced 480 requested turns to turn 481, completed successfully and recorded no terminal warnings or errors.

| Arm       | Run                                    | Verified source                            | Completed  |
| --------- | -------------------------------------- | ------------------------------------------ | ---------- |
| Control   | `43319925-3e3e-4056-add9-db89e8925596` | `e1c8b91d46cde33ae5edf2e49b54e0b015bf1def` | 2026-09-30 |
| Treatment | `31d151b0-0555-4e8d-833b-062e33eceefe` | `ab5e40b78e183f7349985c83c0446552f8621e7f` | 2026-10-01 |

The treatment completed before the implementation merged on 2026-10-03. The source diff contains the intended monetary reference modules, related tests and changelog. The treatment's [original verification](https://github.com/Egg3901/AHDGame/actions/runs/36504465194) passed verify, build, typecheck, lint, formatting and all four test shards; the recorded security and dependency checks also passed. Current reference modules and their tests are byte-identical to that qualified source. All 23 focused monetary-era tests pass, covering exact anchors, missing entries, modern and invalid-year fallback, bounded finite references and boundary continuity.

## Observed outcomes and evidence limits

Treatment coverage contains 372 macro and 186 approval series, each with 480 expected and observed points and no missing turns. The control has terminal reports, but its interval telemetry is unavailable. Recorded status does not independently verify the historical market-mode or autonomy-level flags. Matching preset, seed, source pins and terminal turn therefore supports the recorded run-execution comparison; it does not establish a complete matched-mode causal trajectory comparison.

Selected terminal inflation observations:

| Measure                                  | Control | Treatment | Difference |
| ---------------------------------------- | ------: | --------: | ---------: |
| World inflation index                    |  6.7478 |    2.2097 |    -4.5382 |
| Italy annual inflation, percent          |   15.86 |     16.10 |   +0.24 pp |
| United States annual inflation, percent  |    1.88 |      1.41 |   -0.47 pp |
| United Kingdom annual inflation, percent |    1.59 |      1.43 |   -0.16 pp |
| Brazil annual inflation, percent         |    4.14 |      3.02 |   -1.12 pp |
| Turkey annual inflation, percent         |   21.30 |     21.59 |   +0.29 pp |
| Nigeria annual inflation, percent        |    7.40 |      7.41 |   +0.01 pp |

All returned numeric end-state observations are finite. The issue specifies no quantitative outcome tolerance. These descriptive changes are not a calibrated estimate of the intervention's effect, and no approval-path or full-control-coverage claim follows from them.

## Release review disposition

Accept the scoped reference-continuity fix on its exact-source tests, original passing gate, two successful source-pinned sandbox runs completed before merge and finite recorded outcomes. Those satisfy #2530's stated source and qualification criteria. Retain the control-telemetry and historical-mode limitations above. Broader release 1.12 balance, build and world qualification remain separate; this report does not qualify the later release branch as a whole.
