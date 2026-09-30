# Generic money delivery acceptance

This is one #1328 substep. The parent #2159 banking acceptance remains open.

## Source and checks

Runtime source: `c59ee19f4f29b7990309514863d71592818b0578`. Comparison source: `f42a6c97885866e4df89e50eed583cbfd5c83918`. Later integration includes the merged treasury implementation with no additional runtime difference.

- 43 focused tests passed across generic delivery durability, banking conservation, settlement journal and recovery suites.
- 16 isolated native Mongo cases passed: two normal comparison cases, ten delivery/acknowledgement/cleanup interruption cases, two competing-writer cases, a refused command recovery, and an owner/waiter recovery.
- Both implementations transfer10 from a synthetic source holding1000 to a recipient holding100, ending at990/110. Every accepted recovery retains the combined1100. A refused original command stays refused after eligibility changes; a new command can be considered separately.
- Protected target receipts are released only after the matching journal leg acknowledges its original outcome. Target generations and a fresh journal read guard delayed workers.
- Target lookup uses the stable document id independently of mutable eligibility fields. Legacy pending legs with no surviving delivery evidence remain partial for explicit reconciliation.

Sanitized native results are in [the accompanying JSON](./issue-1328-durable-money-delivery.json).

## Measured cost

For the same two-leg transfer, Mongo command count increases from6 to16, request BSON from1,993 to4,951 bytes, and response BSON from195 to3,556 bytes. The additional operations protect and acknowledge each cash publication. There is no collection scan. These are primitive-level measurements, not a claim that a complete banking turn meets its existing1,000-command budget. Whole-turn and cohort qualification remain part of the open #1328 rollout gate.

## Remaining acceptance

This report does not qualify projection publication, every banking/economy value flow, production migration, cohort activation and clean observation, legacy retirement, or the selected release world. A multi-leg command that already delivered cash before a later authoritative refusal remains partial and visible for reconciliation; recovery does not silently reinterpret that refusal as a new instruction.
