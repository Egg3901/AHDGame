# Reserve-pool journal qualification

Refs #1328 and #2159. This qualifies the existing reserve-pool transfer adoption. Broader banking activation and observation remain separate.

## Executed source

- Baseline: `e2858e5c5007a19a1d9c5b7f5dde000b2a1c6efe`.
- Treatment: `0b40ef17d774a5a5420c17f34ce69c7663b7c1f0`.
- The baseline and each treatment checkout were clean during execution. Baseline evidence is reused from its original run. Treatment includes the baseline development commit, the LOC journal prerequisite through `a094924920`, and the coordinated reserve quote guard. Later report changes do not alter runtime source. The companion JSON records fixture hashes.

## Outcomes

The actual API route and normal banking recovery ran against isolated Mongo with one synthetic central bank at turn 100. The native harness supplies an authenticated chair and permits rate-limit admission. Focused route tests separately cover authorization, the existing cap, cooldown and outstanding-loan restriction. This is a subsystem fixture, not a retained world or production run.

| Transfer                         | Forex pool before | Lending pool before | Forex pool after | Lending pool after |
| -------------------------------- | ----------------: | ------------------: | ---------------: | -----------------: |
| 200 to lending                   |             1,000 |                 800 |              800 |              1,000 |
| 200 to forex                     |             1,000 |                 800 |            1,200 |                600 |
| 200 to lending, existing deficit |             1,000 |              -1,000 |              800 |               -800 |
| 200 to forex, existing deficit   |            -1,000 |                 800 |             -800 |                600 |

Every returned response and cash/cooldown snapshot matches baseline exactly. Combined pool value is conserved, and the next eligible turn remains 124. An actual loan liability fixture also preserves the original refusal when transferring would uncover outstanding loans.

Two financial interruption cases, two audit-delivery interruption cases, two concurrent-command cases and a negative-credit interruption case passed. Normal banking recovery converges without extra cash movements. Audit recovery retains one row with the original actor and trace. Original request identity is retained across retries; deliberately new admin requests remain allowed under the existing policy.

The narrowly scoped atomic mode permits a credit to improve an existing negative destination balance. It applies only to a balanced exchange between `centralBanks.forexRevenue` and `centralBanks.reserveBalance`. Source debits remain guarded; unrelated fields and additional cash mutations are refused. The original reserve quote also guards its deposit backing, loan-book revision and pending admission. The revision changes with publication; loan draws revalidate existing underwriting while holding a recoverable admission. Existing contractual servicing remains permitted.

Five additional native cases use the actual reserve and LOC draw routes, existing underwriting, and production pending recovery. They cover both command orderings, two interrupted admission/publication points and pending-owner recovery priority. All finish with obligations covered, one original cash/debt result and no orphan admission. Fixtures supply authentication and rate-limit admission; no production actor or data is used.

## Focused checks

- 22 atomic helper tests, including original quote generation, bond exchanges, restricted reserve credits and interruption recovery.
- 11 reserve command tests and 8 unchanged pure limit/cooldown tests. The command cases include original deposit/revision changes and pending admission.
- 5 route tests using persisted cash, cooldown and receipts. Their aggregate read retains a fixture stub because the in-memory adapter does not evaluate nested expressions inside `$sum`.
- 1 specific Financials-tab test verifies request identity through network failure, success and a subsequent deliberate action.
- Scoped lint passed. Full final-head CI remains required.

## Performance

| Scope                       | Baseline commands | Treatment commands | Baseline read BSON | Treatment read BSON |
| --------------------------- | ----------------: | -----------------: | -----------------: | ------------------: |
| One transfer to lending     |                 4 |                 19 |                193 |               4,010 |
| One transfer to forex       |                 4 |                 19 |                193 |               4,004 |
| Idle banking recovery phase |                 3 |                  4 |                 46 |                  46 |

Each command includes the original plan, guarded cash/cooldown publication and durable audit. Recovery has an indexed pending query limited to 100 commands. The measured idle phase has private banking disabled, adds one lookup and remains below the existing 1,000-command banking budget. Returned BSON counts cursor documents, excluding transport headers. Active recovery cost depends on pending commands; these figures do not qualify a whole autonomous policy sweep.

No authority, units, limits, cooldown constants, monetary totals or rollout flags were changed. This report does not establish whole-world accounting closure or production observation.
