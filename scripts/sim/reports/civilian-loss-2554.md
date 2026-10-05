# Yugoslav civilian loss and outcome replay, issue #2554

A selected military escalation now freezes an explicit civilian-loss order in the same compare-and-set as its resolved outcome. The portable request is 0.005% of the affected sovereign population per resolved escalation. This quantity and the proportional available civilian age/sex profile are gameplay assumptions, not historical estimates. The campaign casualty score remains a separate pressure signal.

The next eligible population turn applies the request to the frozen region allow-list under current sovereignty, reserves modeled serving cohorts, bounds competing requests by remaining civilians and preserves the existing regional population floor. Actual deaths enter the deaths tally before refugee reception; they do not enter migration. Final vectors and named-region loss results share the existing demographic receipt. Immutable history and outcome completion land before that receipt completes. Reset clears runtime loss history.

The outcome claim compares the exact response snapshot. If a leader responds after the tally but before the claim, resolution fails safely and retries from the current responses. The controlled race preserves both responses and selects negotiated restructuring, without issuing a civilian-loss order.

Yugoslav campaign and track updates retain durable response identities instead of relying only on the last resolution. A separate keyed tension event keeps its identity after the short visible history is truncated. Its guarded state write updates the spike and replay receipt together. Ordinary tension writes preserve keyed receipts. An older escalation replay after a later negotiation changes neither trajectory nor tension. Both identity lists fail closed at 10,000 entries rather than dropping old fences.

The actual authored outcome resolver, demographic phase and pre-context recovery run against an owned disposable Mongo instance. Three synthetic regions contain two Yugoslav origins and one unrelated Austrian region. The un-escalated control advances the same cohorts naturally. The escalation removes exactly 10 civilian residents from the vector sum, records one history entry, leaves the unrelated region unaffected and keeps a military unit's personnel at 1,000. A successor-sovereignty control records zero deaths rather than inheriting an unapproved order. All nine cases below match uninterrupted population projections and completed replay removes nobody again.

| Failure boundary   | Civilian deaths | Commands | Reads | Reply BSON bytes |
| ------------------ | --------------: | -------: | ----: | ---------------: |
| none               |       10.000000 |       59 |    40 |           34,119 |
| outcome-claim      |       10.000000 |       59 |    42 |           39,127 |
| trajectory         |       10.000000 |       61 |    44 |           40,311 |
| tension-before     |       10.000000 |       64 |    46 |           40,796 |
| tension-after      |       10.000000 |       62 |    45 |           40,686 |
| vector             |       10.000000 |       71 |    49 |           44,926 |
| history            |       10.000000 |       74 |    52 |           47,440 |
| outcome-completion |       10.000000 |       76 |    53 |           47,699 |
| header-completion  |       10.000000 |       76 |    53 |           47,699 |

Counts include actual resolution, explicit trajectory retries, first per-database index creation and population recovery on this small fixture. They do not establish full-world performance or an incremental before/after cost. The JSON report records exact gameplay-source hashes. The fixture drops its temporary databases, closes its owned client and stops its own mongod.

Validation: 240 focused tests across 18 suites pass, including casualty rules/outbox, response races, demographic receipts/recovery, ordinary refugees and budgets, full-turn integration and tension. Scoped lint, formatting and architecture checks are reported separately in the PR. Earlier overlapping focused test counts are not additive.

Remaining acceptance: productive-capacity impairment and funded repair, calibrated quantities and source-pinned whole-world runs. Modeled conscripts are reserved; professional military units without home-cohort attribution are not separately reserved from resident vectors. Actual military losses continue to belong to battle settlement. Legacy already-resolved outcomes do not receive new civilian orders or a generic side-effect repair. The new retry covers Yugoslav civilian outcomes, campaign tracks and tension; other outcome effects and final wire delivery are not a general notification outbox. Concurrent reset and turn writers remain unsupported. This report does not establish complete #2554 or release acceptance.
