# Issue2671: stale conflicts after reset

## Cause

The manifest tags `conflicts`, `peaceOffers` and twelve other world collections as runtime data, but places them in the reference array. The reset getter returned only the runtime array rather than entries whose category is runtime. As a result, the required cleanup never selected these fourteen collections. The same getter mismatch affected reference selection.

A second defect swallowed all drop failures instead of only Mongo namespace-not-found errors. Required cleanup could therefore fail without aborting reset.

## Repair

Collection getters select by lifecycle category. Reset waits for every runtime drop to settle and then rejects with the failed collection names if a required drop fails. Missing namespaces remain valid on clean and repeat resets. Reset does not stamp a fresh clock after required cleanup failure, and the orchestrator records a failed teardown.

## Qualification

- 51 focused tests pass across reset, orchestration failure handling and manifest selection.
- Native Mongo populated reset clears all fourteen previously omitted runtime collections, including an active turn390 conflict, while preserving reference and admin-account controls.
- Repeat reset clears the same set and preserves both controls.
- A clean reset accepts missing collections and has zero stale conflicts.
- A native database with an injected conflict-drop authorization error retains the failed conflict, rejects reset and persists `resetRun.status=failed` at `phaseReached=teardown`. It cannot be reported as a successful new world.
- The native qualification uses a generated disposable database, removes it afterward and advances no world turns. It does not reset the hosted sandbox.

Reproduce using `scripts/verify/issue2671-reset-cleanup.ts`, with `NODE_ENV=test` and `AHD_TEST_MONGODB_URI` explicitly pointing at a test Mongo server. The script overrides ambient database helpers to its generated disposable database.

## Limits

This proves reset cleanup and failure reporting. It does not qualify the complete seed, a production launch or the broader critical-diagnostic health requirement in #2672. The existing hosted sandbox's stale record remains until its owner resets it with the repaired source.
