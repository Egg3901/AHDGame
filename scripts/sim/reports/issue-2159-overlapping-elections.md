# Overlapping chamber qualification

Related: #2159, #2124, #2161. Clean executed source: `ccb731078c16e7e086614c32999f1558a379f24b`.

## Fixture and scope

The actual Mongo replay uses `1991-default` at a 1993 fixture clock, deterministic synthetic votes and random seed 2159. Sixteen scenarios combine US House/Senate and Turkish Assembly/Senate pairs, both lower-first and upper-first resolution order, and NPP-only, player-versus-NPP, opposing-player and mixed same-party player/NPP fields. Every scenario resolves both chambers: **32 completed resolutions**.

US Oregon uses the configured five House seats and one Senate class seat. Turkish chambers use explicit six/three-seat fixtures. The Turkish bicameral case exercises the implemented overlap regression; it is not a claim that a Turkish Senate belongs in the historical 1991 manifest. Fresh-bootstrap historical conformance remains separate.

Four local NPPs are already busy when candidate supply runs. The mixed field adds a fifth busy NPP so both chambers contain same-party player/NPP competition. Replaced-party NPPs remain busy in reserve upcoming races rather than becoming an artificial free pool. The real `processChallengerGeneration` generates the missing bench; its second invocation files zero additional candidates. External fetches are blocked and the runner accepts only a new isolated sandbox database.

## Assertions

- Every unresolved overlapping chamber has both party fields and valid existing actors before resolution and after the other chamber resolves.
- Actual field types match the four declared player/NPP mixtures.
- Mongo's production partial unique index enforces one active candidacy per actor. A duplicate cross-chamber insert fails with code 11000.
- The real entry guard finds the blocking active candidacy, including the completed-but-not-yet-resolved window.
- Each completed race finalizes, withdraws its candidates and conserves its configured seat total. The other chamber's field survives.
- Every resulting officeholder's current office agrees with the canonical office key. Local history finishes before the fixture is cleared.

## Reproduced defect

The first Turkish lower-chamber case persisted `deputy` in `electedOfficials` but `milletMeclisi` in the winner's `currentOffice`. The generic resolver fallback used the election's chamber key while its roster writer used `officeKeyForElectionType`. Both writers now use the same canonical mapping. This also covers other implemented chamber/office aliases without changing allocation, weights, eligibility or the candidate-supply algorithm.

The original mismatch failed an actual-Mongo assertion. After the repair all 16 scenarios pass, including player and NPP holders. Sixty focused general-resolution and challenger-supply tests pass; scoped lint and format pass. Full repository CI is the merge gate.

## Related coverage and remaining release gate

The separate persisted matrix in merged #2618 covers 120 normal resolutions, 12 finalized-cleanup retries, 12 interrupted AMS retries and 20 presidential cases through the general dispatcher. Its presidential cases cover popular/EV flips, holds, contingent resolution, election-time apportionment, executive seating and durable finalization. Together these reports supply the bounded multiplayer/overlap criterion in #2159.

This replay does not claim campaign accumulation, a complete historical world, all active races in a world, or final release qualification. The selected final release SHA/configuration and full-world gates remain open. [Measured results](issue-2159-overlapping-elections.json).
