# Bulgarian founding constituent consent

Qualified runtime source: `2dc9a4740e7d8095b1df97ac9a5e0975f141d04a`.

The July 1991 date opens a constitution draft. It no longer independently grants the next regional campaigns ordinary 240-seat capacities. A government or President can introduce the draft, which uses the normal parliamentary bill vote. Passage requires at least 267 of the full 400 constituent deputies. A rejected draft leaves the Grand Assembly rules in force, and another draft requires an explicit revision. An entirely NPC government with sufficient constituent support can introduce one draft, with a visible reason, and cannot repeatedly submit a rejected draft.

The governing founding rule is Article 143 of the [1971 Constitution as amended in 1990](https://www.parliament.bg/bg/19): executive or collective legislative initiative and two thirds of all deputies. The later 1991 Constitution's Article 161 is not the rule governing its own adoption. This implementation exposes government and President initiative; collective quarter-member initiative remains a separate acceptance criterion.

A recorded enacted vote authorizes new ordinary campaigns. In one required transaction, adoption can also rebind a complete untouched primary cohort. Cast totals, snapshot-only votes, finalized tallies, closed primaries and incomplete cohorts prevent rebinding. A failing authority marker write rolls back campaign changes. Competing adopters commit one authority, and the other returns without another settlement. Existing ordinary Assembly settlements and already recorded ordinary ballots retain their outcomes.

Founding-capacity 400-seat campaigns remain outside the native ordinary count. Frozen ordinary cohorts retain the previously qualified 31-district national count and whole-chamber transaction. Existing financial owners continue to back its bounded individual slates, and players remain limited to one mandate.

Validation:

- 94 focused checks across 11 suites pass, including decision availability, 266/267 thresholds, immutable national count, protected routes, UI actions, six-country graph contracts, changelog contracts and turn read projections.
- Eight isolated database journeys pass for actual constituent votes, rejection and explicit revision, untouched, counted, snapshot-only, late and incomplete campaigns, final-marker rollback, competing adopters and human/NPC introduction controls.
- Nine additional existing database journeys pass for ordinary Assembly seating and six democratic 1991 bill flows.
- Scoped TypeScript, lint, formatting and the architecture audit qualify the changed graph. The architecture audit has zero blocking findings and 66 existing warnings.
- The durable transaction CI gate includes the new consent journeys.

Measured commands and BSON bytes:

| Journey                                               | Commands | Request bytes | Response bytes |
| ----------------------------------------------------- | -------: | ------------: | -------------: |
| Untouched single adoption, before concurrency control |       13 |          6401 |           4628 |
| Untouched competing pair, including retry             |       26 |         12601 |           8873 |
| Rejected 266-vote draft                               |        2 |           777 |            567 |
| Approved, existing cast totals                        |       12 |          5368 |           4427 |
| Approved, snapshot-only votes                         |       12 |          5368 |           4457 |
| Approved, primary already closed                      |       12 |          5368 |           4416 |
| Approved, incomplete cohort                           |       12 |          5353 |           4210 |

These are the measured fixture commands, not production wall-clock estimates. The authorization read projects vote totals rather than the full individual voter map. The equivalent earlier single-adoption response was 34006 bytes before that projection, and 4628 bytes afterward.

The wider Bulgarian program remains open for the founding 1990 parallel constituency/list count, collective quarter-member constitutional initiative, later dissolution decisions and fresh source-pinned world horizons. This qualification proves the bounded consent and campaign continuity component, and does not close the complete country or world audit.
