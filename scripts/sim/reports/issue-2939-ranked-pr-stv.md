# Persisted ranked PR-STV qualification

Related issues: #2939 and #2159.

## Source and scope

Executed clean runtime: `42b4a6ccdb5b6894cdce80bc587cccab5a24b58b`. [Measured results](issue-2939-ranked-pr-stv.json) contain 18 actual isolated-Mongo resolutions and five before-seating refusals. The [replay runner](../prStvReplay.ts) exercises the production vote accumulator, general resolver, office writes and shared UI projection helper with synthetic actors. The separate council fixture uses the same resolver with `localCouncil` rather than `dail`.

The selected fixture profile is `1991-default` at a 1993 clock. Regional magnitudes, parties, actors, preference orders and demographics are explicit synthetic fixtures. This is not a historical bootstrap, a competitive campaign calibration or final release acceptance. No production database or external publication was used.

## Count model

Ireland uses ranked transferable ballots, a quota, surplus transfers and elimination, as described by the [Electoral Commission](https://www.electoralcommission.ie/irelands-voting-system/). This implementation uses deterministic weighted inclusive Gregory transfers, a recognized STV model described by the [Scottish Government](https://www.gov.scot/binaries/content/documents/govscot/publications/foi-eir-release/2018/11-a/foi-18-03473/documents/foi-18-03473---related-documents/foi-18-03473---related-documents/govscot%3Adocument/FOI-18-03473%2B-%2Brelated%2Bdocuments.pdf). It does not reproduce Ireland's manual selection of surplus ballot papers.

The quota is the original valid poll divided by seats plus one, rounded down, plus one. Each candidate wins at most one seat. Internal arithmetic is exact rational arithmetic; displayed count totals and transfer values are decimal approximations. All original ballot value remains retained, continuing or exhausted after every count. Unavailable preferences are skipped. Ties use previous unequal counts, then stable candidate identity, rather than a historical random draw.

During actual accumulation, first preferences come from the existing turn distributor. Synthetic later preferences favor candidates in the same party, then candidates closer to the first choice's economic/social positions, then stable identity. Preferences are recorded when votes are cast. This model is not measured historical Irish transfer behavior and does not invent preferences for existing totals.

## Persisted qualification

| Qualification                                                                                             | Result                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Four fields: NPP-only, one player versus NPP, opposing players, mixed same-party actors                   | Three consecutive elections each: initial control, incumbent hold, transfer-driven control flip                                         |
| Same first-preference totals across all three cycles                                                      | 49 first-preference votes for party one; stored preferences produce 2/1 seats, then 2/1, then 1/2                                       |
| Finalization and repeat resolution                                                                        | Count rounds, named holders, one seat per person, current-office weights, candidate cleanup and politician history remain stable        |
| Missing ballots, inconsistent weights, too few candidates, duplicate holder identities, zero cast ballots | All five reject before changing incumbent officials, actor offices or the result tally                                                  |
| Withdrawn first choice, retired NPP, hard-deleted player                                                  | Original valid poll remains 100; votes transfer to available preferences; no unavailable holder is seated                               |
| Injected failure at candidate cleanup after finalization                                                  | Retry preserves already seated officials and count receipt, completes cleanup, and remains stable on another retry                      |
| Actual direct and batched turn accumulation                                                               | Stored ballot weights equal first-preference totals; same-turn replay is stable; stale revisions are refused even at the same timestamp |
| Accumulation and shared UI projection versus final resolver                                               | Identical seat maps                                                                                                                     |
| Irish local council                                                                                       | Three distinct NPP holders receive the counted 2/1 result and matching one-seat current offices                                         |

STV incumbency uses seats actually won rather than the first-preference vote proxy used by existing aggregate elections. Initialization refuses to replace a tally after ballots were cast; concurrent initialization does not overwrite another initializer's document.

## Performance and checks

A matching six-candidate, three-seat, NPP-only resolver fixture uses identical first preferences, parties and actor statistics. The legacy runtime `093daeae41b152c61bb22ad352054ff8cd5cef2a` measures **34 Mongo commands and 6,500 returned BSON bytes**. The ranked runtime measures **34 commands and 6,464 bytes**. Different elected people account for the small byte difference; this is not a claimed speed improvement or a worldwide phase-budget pass. The count adds no resolver database reads.

146 focused integration cases and the final 15 counter cases passed, covering 147 unique cases. The first local cold import of the primary-resolution module exceeded its 15-second test timeout; the complete focused integration pass uses a 30-second local timeout. Scoped ESLint and Prettier pass. Full repository CI is the separate delivery gate.

## Compatibility and remaining reset acceptance

Select the counting path explicitly when initializing a supported Irish tally with `{ countingMethod: "pr_stv" }`. The optional method, original ballot and count-receipt fields require no migration. Existing tallies and current country defaults keep their existing allocator. No current aggregate Irish world is silently converted from seat blocks into individual candidates. Conversion vote penalties and reserved seat floors are refused on this path.

The #2159 competitive-method checkbox remains open. Selected-world adoption requires enough distinct candidates, an immutable method/configuration manifest, and qualification of that bootstrapped world. The broader active-election validity, campaign accumulation, release source and simulation-matrix gates remain separate. This report qualifies the delivered counting path and its controlled persisted outcomes.
