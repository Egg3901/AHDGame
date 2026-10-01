# Generic money delivery acceptance

This is one #1328 substep. The parent #2159 banking acceptance remains open.

## Source and checks

Runtime source: `d0ad45d30542d00536ca1a102e097a47123e1bc0`. Comparison source: `f42a6c97885866e4df89e50eed583cbfd5c83918`. This includes merged treasury integration and the guarded acknowledgement optimization.

- 43 focused tests passed at the preceding runtime `c59ee19f4f29b7990309514863d71592818b0578` across generic delivery durability, banking conservation, settlement journal and recovery suites.
- 17 isolated native Mongo cases passed: two normal comparison cases, ten delivery/acknowledgement/cleanup interruption cases, two competing-writer cases, a refused command recovery, an owner/waiter recovery, and a mismatched-target receipt refusal.
- Both implementations transfer10 from a synthetic source holding1000 to a recipient holding100, ending at990/110. Every accepted recovery retains the combined1100. A refused original command stays refused after eligibility changes; a new command can be considered separately.
- Protected target receipts are released only after the matching journal leg acknowledges its original outcome. Target generations and a fresh journal read guard delayed workers.
- A separate native operator-reconciliation comparison passed at `5a2d39434cc72b61e6bfc31f03bc10794d92759a`. After explicit reconciliation closes a legacy journal, recovery preserves its terminal disposition and the already-reconciled990/110 cash positions.
- Target lookup uses the stable document id independently of mutable eligibility fields. Legacy pending legs with no surviving delivery evidence remain partial for explicit reconciliation.

## Selector compatibility

Compatibility source: `1e638f6a43ccc95b28df992035ceccc9e364d82f`.

- All 70 focused tests passed across generic delivery, journal interruption, banking-turn audit, defence conservation and the two financial-crisis response suites. Scoped lint passed for all changed implementation and regression files.
- Three additional native Mongo cases passed: a mutable country selector freezes its document identity before cash moves and replays after its state changes; a missing destination refuses before debit; and losing the refusal claim acknowledgement still refuses during recovery after the destination becomes available. Combined cash remains1,100 in every case.
- Financial-crisis bank rescues, household stimulus, sovereign grants, austerity projections and guarantee refunds now carry their actual treasury document identities. Treasury ids in the regression fixtures deliberately differ from country ids.
- Crash regressions select the intended financial projection write independently of cash receipt cleanup. Defence conservation uses stateful Mongo filters and journal acknowledgements.

Sanitized native results are in [the accompanying JSON](./issue-1328-durable-money-delivery.json).

## Measured cost

For the same two-leg transfer, Mongo command count increases from6 to14, request BSON from1,993 to4,702 bytes, and response BSON from195 to2,656 bytes. The additional operations protect and acknowledge each cash publication. There is no collection scan. These are primitive-level measurements, not a claim that a complete banking turn meets its existing1,000-command budget. Whole-turn and cohort qualification remain part of the open #1328 rollout gate.

## Remaining acceptance

This report does not qualify projection publication, every banking/economy value flow, production migration, cohort activation and clean observation, legacy retirement, or the selected release world. A multi-leg command that already delivered cash before a later authoritative refusal remains partial and visible for reconciliation; recovery does not silently reinterpret that refusal as a new instruction.
