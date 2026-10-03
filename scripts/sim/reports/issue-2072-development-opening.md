# Modern opening development reconciliation (#2072, #2159)

## Scope and source

Clean executed runtime: `cf464ed82c7ddc312b47d71069bf1ba3a1aec865`. This delivery reconciles focused rehearsal fixes #2810, #2812, #2813, #2819 and #2823 into development. It does not import the broad historical country candidate or replace later development changes.

The original issue-owned opening and ten-turn evidence remains attached to closed #2072. This report verifies the focused repair on development; it does not grant a second closure, selected release conformance, historical fidelity or full-world acceptance.

## Persisted and regression checks

All **64 cases across 12 test files** pass at the clean runtime above. Native Mongo modes are explicitly enabled for the five fixture modules, covering both 1991 and 2019 openings. The disposable databases contain synthetic actors and use guarded isolated cleanup.

- Selected fallback party rosters retain all 27 identities through the actual reset finalizer; obsolete and absent-country rows are removed.
- Empty modern contests receive eligible distinct unseated candidates with authored home regions and valid party presence. Named cases cover Irish councils, Nigerian councils, German regional executives, US presidency and concurrent Vermont House contests.
- Party benches and candidate fields preserve existing officeholders and No Parties player countries; retries do not add actors or candidates.
- Successor parliamentary primaries receive actual floor candidates, with persisted party membership visible to the health phase.
- Foreign, retired and missing NPC affiliations do not satisfy party membership. Active valid affiliations remove false empty-party warnings.
- Fresh worlds without human characters retain empty-party diagnostics. A native regression first reproduced suppression of four genuinely empty parties, then passed after restoring the check. The human-present control also passes.
- Existing health summary and projected-read regressions pass.

The finalizer, bench, opening-field and successor checks exercise production functions against isolated Mongo. These are controlled subsystem fixtures, not a complete bootstrap or a normal full-world turn.

## Matching health-phase performance

The same synthetic zero-human fixture runs the actual complete health phase before and after the membership repair:

| Runtime                                                         | Mongo commands | Returned BSON bytes | Empty-party warning count |
| --------------------------------------------------------------- | -------------: | ------------------: | ------------------------: |
| Development baseline `b121e4b492502db6eb4113bff0baaaee6b0bf1ed` |             34 |               3,862 |                         6 |
| Reconciled runtime `cf464ed82c7ddc312b47d71069bf1ba3a1aec865`   |             35 |               3,963 |                         4 |

One bulk membership lookup recognizes two valid NPC-backed parties. No per-party query loop is added. The measured 35 commands stay below the existing default phase budget of 500. This fixture does not qualify full-world CPU, decoding volume or turn budgets.

## Delivery and remaining gates

Scoped ESLint, formatting and diff checks pass. Full hosted checks are required on the final delivery revision before merging.

A fresh integrated bootstrap and normal-turn replay must include the selected country source and immutable production manifest. Country fidelity under #2488, current-source seed conformance, the final release commit and #2159 simulation matrices remain open. Queued simulations retain their existing sources. Production is untouched.
