# Existing-world migration and normalization confirmation

Issue: #2159. Runtime and replay source: `b0fb427bb2260e1719c19f94c8c11c53642b6a55`.

This confirms the migration half of the reset-configuration criterion. Reset CLI target selection has separate evidence. This report does not constitute the full reset and ten-turn rehearsal or freeze the release configuration.

## Contracts and repaired gaps

| Path                          | Existing-world behavior                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application startup           | `startupMigrations.ts` runs four audited idempotent entries: equity pools, orphan fund repair, provider identity indexes, central-bank pricing phase-in. It does not import the entire historical registry.                                                                                                                       |
| Explicit migration runner     | Selects registry order, skips completed markers, writes a completion marker only after successful execution, and stops on errors. Preview passes `dryRun` and writes no completion markers.                                                                                                                                       |
| Held and rollback migrations  | Outside the ordinary registry; the CLI exposes them only through an explicit `--only` selection.                                                                                                                                                                                                                                  |
| Forced migration retry        | Now rejects any non-idempotent selected migration before executing any entry. Unknown IDs, empty selections, conflicting selectors, and force without selection also fail before execution. Repeated selected IDs execute once.                                                                                                   |
| Generic config adoption       | Fills absent reference keys. During the first 24 turns it can also adopt differing boolean/string gates. Existing numeric tuning is preserved. Market tiers only rise in that early window without operator provenance; mature or explicitly chosen tiers remain unchanged. This is an explicit migration, not every web startup. |
| Campaign era pricing          | Now excluded from generic existing-world adoption. Core seed top-ups preserve both absent legacy flags and explicit false/true settings. Fresh insertion and a deliberate core reset enable the reference default. No campaign cash or personal wealth migration is introduced.                                                   |
| Reset gameState normalization | `missingGameStateFlagDefaults` fills absent keys; explicit choices remain. Legacy NPP boolean and level are treated as a pair so explicit disabled autonomy is not resurrected. Preset-derived configuration still has its own seeders.                                                                                           |
| Reset persistence             | Manifest classifies `migrationsRun` as preserved. Core seed does not drop `gameConfig`; it refreshes reference configuration while retaining fields outside that reference and explicitly clearing stale per-world markers. This is not a promise that every reference default survives a reset unchanged.                        |

Two real compatibility leaks were fixed: the generic gate migration could enable era pricing on retained worlds, and core seed top-ups could do the same. The migration runner also failed to enforce its documented non-idempotent force refusal and silently accepted misspelled selections. The monetary era-pricing formula is unchanged.

## Retained source and explicit fixtures

- Saved run: `559d9701-e07f-48c8-ade1-294bc926820a`, generator `b4eb48872d6b17d64cd91a85202619f181797713`, saved turn 13.
- Copied all one config, one gameState, five migration markers, zero campaigns, and a deterministic first 128 share-history rows ordered by ID.
- Source cohort hash before and after: `d7e0f0e0aeb85207963c35e4cf7211960181d2e1af8d65e67592536d33f07559`.
- All writes used an isolated target. The hash covers exactly those copied cohorts, not every collection in the source world.
- Added one synthetic campaign with 731.25 cash, a purchased fundraising branch, and legacy ground-game depth; one stale split row with its structural movement; and explicit config sentinels. The copied target clock was set to turn 500 for mature-world adoption. Six separate target cases exercise absent/false/true pricing flags at turns 2 and 500.
- Existing markers for the three selected migrations were removed only in the isolated target so the actual implementations could run. Other copied markers were retained.

## Observed results

| Check                                                            | Result                                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Actual config, campaign-tree, and share-action migration preview | Complete target document and marker hash unchanged                                                                         |
| Apply                                                            | Exactly one updated document per selected migration; completion markers persisted                                          |
| Marked retry                                                     | Complete target hash unchanged                                                                                             |
| Explicit forced idempotent retry                                 | World data unchanged; successful marker timestamps may refresh                                                             |
| Four invalid selections, including mixed safe/unsafe force       | Each rejected with no target mutation                                                                                      |
| Campaign investment                                              | 731.25 cash and purchased fundraising branches preserved; legacy ground-game level 5 became starter plus branches 3/1/0    |
| Corporate-action normalization                                   | Executable shares, price, and notional became zero; structural share movement remained intact                              |
| Six flag and age cases                                           | Migration and top-up preserved absent/false/true; explicit reset enabled reference pricing and retained unrelated sentinel |
| Fresh config insertion                                           | Reference campaign pricing enabled                                                                                         |
| Legacy NPP disabled flag and living-conflict false flag          | Default-fill helper preserved both explicit choices                                                                        |

The executable runner is `scripts/sim/existingWorldMigrationReplay.ts`; machine-readable results accompany this report. It requires distinct sandbox source/target names, an empty target, and a clean source checkout. Public output excludes database names, connection strings, and record identities.

## Verification and scope

69 focused tests passed across the migration runner, startup allowlist, registry contract, config adoption, core-reset config, gameState flag defaults, and dedicated config seed suites. Scoped ESLint and diff checks passed. The core config updater is exercised against real Mongo in the replay; its extraction keeps the original reset/top-up behavior except for the repaired pricing flag.

This is representative confirmation of migration selection, persistence, compatibility, and normalization contracts. It does not claim every historical registry entry was applied again, that production was changed, or that an unreviewed full historical migration pass is safe. Migrations remain serialized maintenance operations; the marker protocol is not a distributed concurrent-run lock. Individual migration bodies must honor dry-run and idempotency contracts. Failure after a partial body write is handled by that body's repair/retry policy, not a cross-migration transaction.

No per-turn path changed, so no turn-performance benchmark is required. Full remote CI remains the merge gate.
