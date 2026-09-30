# Savings migration retry: native Mongo qualification

Source: `3d67b68752145f9494433ff9da34e400cbe222b0`. Five independent synthetic sandbox fixtures use production migration loader/planner, settlement journal, and Mongo writes. No live database, production activation, balance repair or full-world claim.

Each fixture starts with a 700 household pool, 500 bank vault, 700 legacy savings, 2,000 NPC deposits and 2,500 loans. The bank's pointer deposit total is 2,700. The household pool exactly covers required backing, exposing the original completed-retry failure.

| Case                       | Persisted interruption                                                       | Result                                                                        |
| -------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Completed migration retry  | Fully applied original journal; pool already zero                            | Replays original journal; no second funding requirement or debit              |
| After pool debit           | Pool zero, vault 500, no account/liability                                   | Original accepted transfer delivers missing 700 credit, account and liability |
| Lost vault acknowledgement | Pool zero, vault 1,200; journal credit acknowledgement absent                | Target receipt prevents a second 700 credit; projections finish               |
| Projection interruption    | Both cash legs and account insert present; player liability still zero       | Original plan recognizes liability exactly once                               |
| Existing shadow account    | Account exists before migration, with no migration journal or funded backing | Still requires/transfers 700 backing; preserves one account                   |

In every case the resumed state is pool 0, vault 1,200, player liability 700, unchanged legacy savings 700 and exactly one matching open authoritative account. Cash starts and ends at 1,200. The interrupted debit-only case temporarily has 700 held by the pending journal; recovery delivers it, with no mint or replacement funding. Every final journal has both original legs and all projections complete. There is exactly one migration journal per case. Another completed retry is reconciled, reports one replay and zero new backing requirement, and leaves all financial/account/journal snapshots unchanged.

Full-database hashes before and after both initial and interrupted-state loading/planning are identical in all five cases. Planning is read-only and does not resume accepted transactions. Fault injection wraps native Mongo calls only to throw at exact write boundaries; all balances, receipts, accounts and recovery operations persist through the real driver.

The accompanying JSON contains only synthetic aggregate state, journal leg outcomes and planner/batch results. Runtime source was clean at start. The private harness is retained with the evidence; no application files were edited by this qualification.

## Regression and planner semantics

The baseline first migration reconciles, then its completed retry incorrectly reports a 700 pool shortage. Completed receipts now contribute to outstanding account liabilities without being counted as a new backing transfer. Merely existing shadow accounts do not qualify as funded receipts.

Apply recovers original pending journals only in authoritative mode, for selected currencies that have not entered the read cohort. A failed recovery stops before new transfers. The public migration loader and pure planner remain read-only. Rates, limits and displayed savings are unchanged.

Six pure planner tests and ten integration tests pass, including shadow-mode, activated-read-cohort and unselected-currency recovery gates. Run them with:

```sh
npx vitest run src/lib/savings/rules/migration.test.ts src/lib/savings/__tests__/migration.integration.test.ts
```

[Sanitized native results](issue-1328-migration-recovery.json) record each interrupted and recovered boundary. Production observation, activation and compatibility retirement remain open under issue #1328.
