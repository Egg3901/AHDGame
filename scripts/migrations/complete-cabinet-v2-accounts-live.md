# Cabinet v2 actions and live account repair

Issue: https://github.com/Egg3901/AHDGame/issues/3778

Every rostered office has an institutional spending account and at least two distinct Staff choices. Staff choices consume charges but no department cash. Accounts without legislative claims can remain at zero. Existing paid actions retain their authored costs, durations, cooldowns and stacking limits.

## Gameplay

`src/lib/resetCabinet/rules/gameplay.ts` owns the portable adapters. The shell loads a projected, world-bound action batch and checks verified system versions, country, seed turn and active intervals. National and territorial scopes retain the existing stacking cap. The existing veteran scope affects regional service inputs; there is no separate veteran cohort board.

| Consumer                                   | Active input                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Approval                                   | Temporary service response, separate from observations and within the existing positive modifier cap. Party discipline is excluded.                                                                                                                                                              |
| Corporation conditions                     | Favorable political-family input pressure, capped at 0.2 points per family.                                                                                                                                                                                                                      |
| Production, energy and demographic bridges | Temporary family inputs where owners consume the existing bridge. V2 demographic owners retain their own cohort inputs.                                                                                                                                                                          |
| Macro targets                              | Lower unemployment, poverty and living costs; higher trade growth and productivity, through existing smoothing and bounds.                                                                                                                                                                       |
| Production capacity                        | Robotics and business-entry pressure together add at most 0.2 annual percentage points through potential growth and the normal output-gap calculation.                                                                                                                                           |
| Legislative voting                         | Formed-government supporting parties receive bounded additional pressure from an existing directed whip. Opposition, absent directives and player ballots are unaffected. Immediate hard-whip success rules remain unchanged; fallback and autonomous cross-pressure use the stronger directive. |

These are temporary inputs, not writes to observed boards or grants of cash, firms, migration stock, recovered receipts or combat readiness. Economic consequences pass through the simulation and may persist after input pressure expires. V2 macro nodes retain finer smoothing baselines so small effects can decay after expiry. The v1 node configuration is unchanged.

The offline qualification in `scripts/sim/ministerActionsV2Qualification.ts` exercises repeated cash-free choices, actual trade/cost macro evaluators, expiry, bounded production pressure and unchanged account settlement. It is a deterministic consumer simulation, not a complete live-world performance or balance benchmark.

## Prepared live migration

`2026-10-10-complete-cabinet-v2-accounts` inserts missing zero-balance accounts and restores missing treasury roster references. It preserves existing funds, obligations and claims, requires settled current-world treasuries, refuses an active turn, and uses the explicit database client's transaction session.

Run from the repository root with `.env.local` containing `MONGODB_URI_LIVE`. Optional `MONGODB_DB_LIVE` overrides the URI database. Local URI/database variables are ignored. If neither live database override nor URI database is supplied, the existing application default database name is used.

```powershell
npx tsx scripts/migrations/complete-cabinet-v2-accounts-live.ts --dry-run
```

Review insertion and treasury-update counts before a separately authorized live apply:

```powershell
npx tsx scripts/migrations/complete-cabinet-v2-accounts-live.ts --apply
```

Only this migration is selected. `--force` rechecks an existing marker and remains idempotent. Dry-run writes neither account data nor a migration marker. MongoDB transaction support is required. No action-state migration is needed: gameplay consumes existing world-bound records, and Staff catalog additions do not change persisted shapes.
