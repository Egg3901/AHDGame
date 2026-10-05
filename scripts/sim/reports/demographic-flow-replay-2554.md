# Demographic replay prerequisite for #2554

The actual demographic phase resumes five interrupted Mongo write boundaries without advancing age or migration twice. Every recovered snapshot equals uninterrupted output, and a completed phase replay writes zero population targets. Uninterrupted population math also matches the prior-source phase at `d7da4e6a89b118359544761b116c7ff314db72cb`.

Run `npx tsx scripts/sim/demographicFlowReplay2554.ts --mongo-url <disposable-loopback-url>` against an isolated local Mongo instance. The harness creates randomly named temporary databases and drops them in `finally`. To compare the prior phase, export the baseline source and supply its `src/lib/demographics/phase.ts` as `--baseline-phase <exported-file>`. The measured comparison used a byte-verified copy of that file at the named baseline. It compares that production phase function, not an entire prior-source world.

[JSON evidence](demographic-flow-replay-2554.json) records two synthetic US regions with age/sex cohorts and all failure boundaries. No player or live-world data is used.

| Interrupted write                       | Recovery                   | Matches uninterrupted | Completed replay target writes |
| --------------------------------------- | -------------------------- | --------------------- | ------------------------------ |
| demographicFlowProjections / insertMany | Replan unpublished attempt | Yes                   | 0                              |
| regionDemographics / bulkWrite          | Resume frozen plan         | Yes                   | 0                              |
| states / bulkWrite                      | Resume frozen plan         | Yes                   | 0                              |
| macroMetrics / bulkWrite                | Resume frozen plan         | Yes                   | 0                              |
| demographicFlowReceipts / updateOne     | Resume frozen plan         | Yes                   | 0                              |

Bulk failures land the first target operation before throwing, so the fixture exercises partial writes inside a collection as well as across collections. The final receipt failure occurs after all targets are stamped. The unpublished projection failure leaves one inert orphan chunk and no published header; the new attempt safely recomputes because no population writes were allowed. Completed projection chunks are deleted, while compact completion metadata remains for replay.

The journal first freezes all regional projections under one plan identity, then publishes the unique world/turn receipt. Target writes set the computed values and their receipt stamp atomically. An already stamped target is skipped, preserving later same-turn edits. A later-turn or conflicting stamp aborts recovery. Completion requires observing all three collections at the receipt stamp. A concurrent publisher uses the winning stored plan and removes only its own losing chunks.

Generic turn crash recovery still skips other interrupted phases. Before rebuilding the resumed state context, population receipts are drained in turn order. A missing receipt only makes the interrupted population phase retryable when its durable attempt marker proves it used the new freeze-before-write path. A legacy interrupted phase without that proof remains skipped because its old partial writes cannot safely be reconstructed.

## Database cost

| Two-region uninterrupted phase | Previous source | Candidate |
| ------------------------------ | --------------- | --------- |
| Mongo commands                 | 10              | 27        |
| Read commands                  | 7               | 19        |
| Reply BSON bytes               | 4786            | 12477     |
| Returned documents             | 8               | 25        |

The measured phase cost rises from 10 to 27 commands, including read growth from 7 to 19. Batched target verification and frozen projection storage are the added work. There is no per-region query on the production path. The normal turn setup also adds an epoch check and pending-receipt query; two index-creation commands run once per database handle. Legacy identity initialization adds its own one-time reads/write. These setup costs are outside the table. Cold first-pass milliseconds are diagnostic and do not establish whole-world throughput.

## Schema and lifecycle

`GameState.worldEpochId` is optional for existing worlds. New initialization and each reset assign a fresh identity; the next normal locked turn initializes an unstamped legacy world with a compare-and-set. Reset clears the attempt marker and sweeps both runtime journal collections. Target stamps from an older epoch can be replaced only after the current world identity is checked. There is no live reset or manual migration in this validation. Unpublished orphan chunks may remain until reset.

The epoch check assumes the normal single turn owner and a reset with turn processing stopped. It does not make concurrent reset and turn writers atomically isolated. Legacy partial demographic writes still need separate diagnosis if they have already occurred.

This change supplies replay safety for future conserved crisis effects. It does not yet implement or qualify refugee choices, host-service budgets, typed casualties, productive destruction, repair obligations or a source-pinned conflict world. Those #2554 acceptance criteria remain open.
