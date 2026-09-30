# Persisted election resolution matrix

Related issues: #2124, #2161 and #2159.

## Provenance and scope

Clean executed runtime: `d49c8c3ce932f7e8b72a0ee33d235f0158e047ce`. The [general runner](../generalElectionMatrixReplay.ts) uses the real resolver, actual Mongo writes and deterministic synthetic actors and vote totals. The [measured JSON](issue-2124-persisted-election-matrix.json) includes all results, the separate cleanup interruption replay, the presidential dispatcher replay and the earlier AMS profile.

This is selected `1991-default` resolver qualification at a 1993 fixture clock. It is not a bootstrapped historical world, a full campaign-accumulation test or the final release candidate. Regional magnitudes and the one-Land AMS electorate are explicit fixtures. The 630-seat AMS total is the current configured total, not a separate claim of historical seed fidelity. The East German quota and converted-regime fixtures are counterfactual control tests on that clock.

The runner refuses non-sandbox Mongo addresses, populated targets and dirty acceptance source. It blocks external fetches and verifies the source commit remains unchanged. All actors and votes are synthetic; no live player data is used.

## Matrix

Each fixture runs three consecutive elections with an initial party-one lead, a party-one hold, then a party-two swing. Four direct-candidate fields are tested: NPP-only, player versus NPP, opposing players and mixed same-party player/NPP. Mixed single-winner fields use shares that account for vote splitting; party totals alone do not elect a single candidate.

| Fixture                                | Persisted route                      | NPP-only party seats across the three cycles |
| -------------------------------------- | ------------------------------------ | -------------------------------------------- |
| US governor                            | single winner                        | 1/0, 1/0, 0/1                                |
| US state senate                        | Hare quota                           | 4/2, 4/2, 2/4                                |
| US districted House                    | district quota and holder assignment | 4/1, 3/2, 2/3                                |
| UK Commons                             | Hare quota                           | 57/24, 49/32, 24/57                          |
| Irish Dail                             | Hare quota                           | 4/2, 4/2, 2/4                                |
| DD National Front                      | fixed bloc quota                     | 83/17, 83/17, 83/17                          |
| DD democratic conversion               | Hare quota                           | 70/30, 60/40, 30/70                          |
| German Landtag                         | Sainte-Lague                         | 84/36, 72/48, 36/84                          |
| German AMS, shared direct/list holders | direct plus reconciled list          | 441/189, 378/252, 189/441                    |
| German AMS, separate list holders      | direct plus reconciled list          | 441/189, 378/252, 189/441                    |

The separate-list fixture adds two synthetic player list candidates to every direct-candidate field, including its NPP-only direct ballot. It is deliberately a player-list treatment, not an entirely autonomous electorate.

**120 resolutions pass across 40 three-cycle sequences.** All 40 second cycles retain leading-party control. Thirty-six competitive third cycles flip control; four fixed-quota third cycles correctly retain party-one control. The two-party National Front fixture normalizes the authored quota among its two represented parties; it does not claim the full five-party historical chamber split.

Every cycle checks finalized tally, withdrawn candidates, seat conservation, named existing holders, current-office agreement and repeat stability. District cases also check exactly one correctly typed player/NPP holder per district. Multi-seat holders' office counts match their persisted mandates. A second resolution changes none of the officials, characters, NPPs, candidates, notifications, district holders or local politician history. AMS reconciliation also refuses a second application of the same cycle.

Each new tally stores the route that actually ran, its resolution turn, and immutable holder identities, party, seat weight and direct/list source. The replay verifies that every archived holder and total matches the persisted chamber, including list-only representatives. Historical rows are not backfilled from current configuration. AMS direct results are only upgraded to `ams` after list persistence and holder reconciliation succeed.

Two original issue labels describe obsolete or unimplemented behavior: the historical Commons winner bonus was removed in #2222, and Ireland's documented allocator is a Hare-quota approximation. Ranked STV transfer rounds are not implemented or claimed by this matrix.

## Reproduced defects and repairs

1. **AMS holder mismatch.** Before the repair, a two-party fixture persisted 441 seats for a holder while their current office still reported 28 direct seats. List reconciliation now refreshes direct-plus-list mandates, seats list-only holders, clears departed holders and preserves parliamentary executive roles. For NPP aggregate representatives reused across several Lands, the office retains its existing Land and counts that Land's mandates; `electedOfficials` remains authoritative for the complete chamber.
2. **Incomplete finalized-result recovery.** The runner throws at the real candidate-cleanup write after the result is finalized. Previously retry marked the race resolved with two stale active candidates. The repaired retry completes candidate/campaign cleanup, concurrent winner-candidacy withdrawal, party presence and local history without seating again. The separate 12-resolution governor replay passes, including the injected failure.
3. **Presidential dispatcher bypass.** The general finalized-result shortcut could bypass `executiveSeatingPending`. The dispatcher now returns those cases to the presidential resolver. The existing 20-case presidential matrix passes through the real general dispatcher, including both actual seating interruptions and lost acknowledgments after the tenure receipt, for 1991 and 2027. The earlier direct-resolver evidence remains valid; it alone did not cover this wrapper defect.

4. **Interrupted AMS reconciliation.** A real injected holder-write failure previously left the election resolved and swallowed the error. The resolver now returns that race to completed status, propagates the failure and retries reconciliation from its finalized direct tally. A separate 12-resolution AMS replay passes after the interruption, with complete direct/list receipts and stable repeat resolution.

The fixes do not change election weights, thresholds or seat-allocation formulas. Schema additions are optional receipts; existing worlds need no data rewrite and legacy reports must treat absent receipts as unknown.

## Verification and performance

104 focused tests pass across general resolution, AMS, Landtag, holder reconciliation and changelog validation. Scoped ESLint and Prettier pass. Full repository CI remains an independent merge gate.

A matching two-party NPP AMS fixture measured 51 Mongo commands and 8,409 returned BSON bytes before, versus 60 commands and 9,857 bytes after. The added holder queries and writes are batched rather than per holder. This measures one reconciliation, not a worldwide phase or full-load budget pass.

## Remaining acceptance

#2124 and #2161 remain open pending qualification on the selected release SHA and immutable configuration. The standing per-family report is delivered separately in #2620. It distinguishes holder replacement, party seat changes, unique control changes, tied control, retention and player/NPP outcomes; this controlled matrix is not a natural-world turnover-rate estimate.

The child issues explicitly request deterministic scripted-vote fixtures. Full campaign accumulation, active-world candidate validity and overlapping upper/lower candidacy scheduling remain separate #2159 requirements; they are not added as new child acceptance gates here. This report does not claim those whole-world requirements or a frozen release manifest.
