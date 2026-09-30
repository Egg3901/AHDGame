# Banking projection recovery qualification

Refs #1328 and #2159. This qualifies bookkeeping publication at the existing settlement boundary. Broader banking adoption and accounting observation remain separate.

## Executed source and scope

- Baseline: `6bdb1f0344885a42bc1bbdeb3d537dd7f7dbd4e5`.
- Treatment: `b8acbb11b8d02163507a36c22b3ae7370cfedde3`.
- Both checkouts were clean during execution. The baseline retains the original generic update-projection implementation. The treatment contains the reserve and LOC prerequisites; their command behavior is outside this fixture.

The fixture runs actual `settleTransition` and `recoverProjections` against isolated Mongo, using synthetic bank and borrower documents. No authentication, API authorization or world simulation is exercised. Fixture hashes and measured results accompany this report.

## Results

The ordinary two-leg transition exactly preserves baseline: payer cash 900, recipient cash 100 and booked value 100. A subsequent independent bookkeeping command adds 25 once.

Twelve native cases passed: one ordinary transition, five interrupted-delivery cases, two legacy compatibility cases, a delayed publisher, pending-owner recovery and two selector compatibility cases. Mutable status filters do not prevent recovery from finding the original target. Target evidence is released only after the matching journal acknowledges it; a waiting command can acknowledge the exact prior owner without scanning other commands.

A historical unfinished projection with a stable original identity and surviving target evidence completes normally. An ambiguous historical record stays partial for explicit reconciliation. Recovery does not infer an outcome from absent evidence.

New update projections bind existing selectors to a stable target identity before claiming the journal and cannot modify their reserved publication fields. A missing target is rejected durably before any cash moves; later target availability does not reopen that command. Their original persisted update remains authoritative. Existing amounts, rates, eligibility and rollout flags are unchanged.

## Cost

| One transition      | Baseline | Treatment |
| ------------------- | -------: | --------: |
| Mongo commands      |       10 |        13 |
| Request BSON bytes  |    3,627 |     4,920 |
| Response BSON bytes |      335 |     1,071 |

These measurements include all commands in the ordinary two-leg, one-projection settlement, before retry calls. They exclude fixture setup and transport headers. The added work reads the target generation and original journal, then releases the acknowledged target evidence. This boundary measurement does not establish a whole-phase budget or whole-world accounting closure.

Focused qualification passed 38 tests across the projection, settlement journal and interbank files at `ab26d093a0d0bfbde40fe29545cb02d33ad7091a`. The subsequent selector follow-up passed two focused cases plus scoped lint at the final native source. The final native run includes those selectors and the fiscal budget-identity compatibility fix from `63844d59a5`. All applicable final-head CI remains required. Generic money-leg durability has separate source and qualification.
