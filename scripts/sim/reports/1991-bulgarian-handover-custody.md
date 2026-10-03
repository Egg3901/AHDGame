# Bulgarian constitutional handover custody

Qualified runtime source: pending final source pin.

An enacted constitution could resize an untouched five-region cohort to240 seats while leaving its native400-seat election and tally flags in place. A renewed poll with no new votes could also be mistaken for an untouched first round. The handover now clears both founding flags with the complete capacity change, inside the same required transaction as constitutional authorization.

Portable eligibility requires five distinct regions, one cycle, matching first-round bindings, an open filing window, a complete zero-vote tally set and no national count receipt. Any journal with the cohort's stable receipt id freezes it, even if its stored cycle field is inconsistent. Renewed polls, unknown rule versions, missing peers, finalized tallies and cast votes retain their existing rules. Existing candidate identities, filing reservations and historical ballots remain intact.

Qualification passes24 distinct checks across four suites: three portable handover cases,11 actual founding-consent Mongo cases, seven native founding journeys and three ordinary seating journeys. Consent qualification retains the266/267 adoption boundary and adds bound first-round, renewed-poll and existing-receipt cases. The native first-round case includes an injected late marker failure, restoration of both election and tally documents, concurrent adoption and replay. Scoped TypeScript, touched lint and formatting pass. Architecture reports zero blockers and66 existing warnings.

| Isolated authorization journey           | Commands | Request bytes | Response bytes |
| ---------------------------------------- | -------: | ------------: | -------------: |
| Earlier consent competing pair           |       26 |         12601 |           8873 |
| Current untouched competing pair         |       29 |         14529 |           9841 |
| Current bound first-round competing pair |       29 |         14529 |          11581 |
| Existing renewed poll retained           |       13 |          5862 |           5664 |
| Existing receipt retained                |       13 |          5862 |           5699 |

The added work is one projected receipt lookup and one batched tally-flag update when an untouched cohort is converted. These are fixture command and BSON measurements, not production wall-clock estimates. NPC financial-owner reads are unchanged. No new collection or financial account is introduced.

Migration is additive and applies on actual enacted authorization. Settled campaigns are not recounted; live campaigns with recorded votes retain their frozen rules. This component does not complete the separate legal term clock, constituent continuation/dissolution, statutory vacancies, later early elections or fresh integrated whole-world qualification. Those remain active in the parent repair program.
