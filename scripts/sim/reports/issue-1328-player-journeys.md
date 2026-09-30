# Banking player journeys for issue 1328

## Scope and provenance

This is a bounded browser and banking-turn qualification against an isolated copy of retained banking context. It is not a full world simulation, a production activation, or permission to remove compatibility projections. The scenario discloses synthetic users, corporations, capital and underwriting inputs; it does not claim historical player actions.

The browser runs actual application pages and submits their actual commands to a loopback-only Next server. All Mongo aliases point to a fresh sandbox database. Hosted background jobs are disabled, external browser requests are blocked, authentication is synthetic and ephemeral, and the runner stops its own browser/server. Original retained data is used as read-only context.

The US board appointments and Irish chair appointment are scenario inputs. The committee's NPP ballots come from actual policy rules. The Irish authority uses the retained independence/FX rules. No historical statute or player approval is fabricated.

## Verification boundaries

- Initial fixture charter and capitalization are disclosed setup. A later real supervisory unwind is followed by actual charter issuance and capital funding through the corporation bank console.
- Savings: actual bank-selection modal, deposit, withdrawal and both holder moves.
- Loan: actual corporate borrower selection and underwriting quote, API origination, settlement and subsequent servicing.
- Turn: actual banking, solvency and committee phases; the global turn pipeline is not claimed.
- Read models: actual banking hub after turn agrees with account and loan records.
- Recovery: undelivered holder request changes no balances and shows actionable feedback; explicit user retry succeeds.
- Stale destination: real charter revocation after opening the deposit modal; the successful deposit remains with the central bank, reports routing failure and closes. Reload does not repeat it.
- Governance: actual US committee ballot and Irish chair rate change, persistence and cooldown.

## Reproduced repair

The holder selector's fetch rejection escaped as an unhandled promise, leaving the player without an error message. A focused component regression failed on that behavior before the repair. The repair adds a catch message while the existing finally restores the selector. Ten banking component tests pass. It does not keep successful deposit commands retryable.

The real browser also reproduced a completed deposit remaining in its form while the subsequent hub refresh was delayed. A read-only authenticated probe against that exact persisted deposit returned 200 three times: cold 62.16 seconds (53 seconds compilation, 6.6 seconds application work), then 359.6 and 878.4 milliseconds warm. Its account, selected holder and backing were correct. The repair closes a successful deposit before awaiting refresh, including successful central-bank fallback. Both deferred-refresh regressions failed before the repair and pass after it. It does not relabel refresh failure as a failed deposit.

Charter capital previously used a conserved atomic document update outside the journal. It now records equal treasury-debit/vault-credit legs and publishes the complete charter plus its cash in one document write. A durable receipt makes recovery safe after that write and before journal acknowledgement. The recorded receipt generation prevents abandoned intents from becoming eligible after an intervening operation restores earlier state values. Fourteen atomic tests, thirteen existing journal tests and twenty-two charter tests pass; the charter tests include interrupted real issuance and no second debit. Economic constants are unchanged.

## Source and continuation

The original $1,000,000 browser deposit executed on `813e9d60e0`. A verified continuation on `2e2bb59d3f` exercised the withdrawal, both holder directions, corporate loan, banking/solvency/committee turn, undelivered-request recovery, and stale-bank fallback. The runner checks the original balance and loan snapshots before resuming. It never repeats completed commands or supplies replacement capital.

Governance, charter issuance/funding and turn 567 completed on `5d4e1002a5c90c8150fb0839831e3e0a8d8c33e8`. Approval-required lending and turn 568 completed on `cb68eeee5b872cebfd908f8b0e90236fea16ab1a`. The recharter counter repair was separately qualified on `b82b6e9051886eb546f803e4017185d6dd9feb3f` through turn 570. This is a composite qualification, not one uninterrupted browser session. The Next development app uses an explicit harness-only route-retention flag. Decorative hero images, flag images, online status, poll banners and global alert polling are excluded; all banking, authentication, game-turn, central-bank and corporation command APIs remain real.

## Completed financial steps

| Step                      | Actual result                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deposit                   | UI submitted $1,000,000; savings and private-bank cash/liability increased together.                                                                       |
| Withdrawal                | UI withdrew $200,000; wallet increased, savings and backing decreased.                                                                                     |
| Private to central holder | $800,000 stayed owned by the saver; bank cash/liability both fell $800,000.                                                                                |
| Central to private holder | $800,000 stayed owned by the saver; bank cash/liability both rose $800,000.                                                                                |
| Corporate borrowing       | Actual $100,000 loan at 6.875%; bank cash decreased and borrower treasury increased equally.                                                               |
| Bank turn 566             | Savings interest $8.33; named loan principal fell to $90,909.09090909091; actual banking, solvency and FOMC phases ran.                                    |
| Read model                | Reloaded banking hub matched the account and serviced loan.                                                                                                |
| Failed delivery           | One holder PUT aborted before server delivery; no balance or journal mutation, actionable feedback, no unhandled failure.                                  |
| Explicit retry            | A subsequent real UI holder command succeeded.                                                                                                             |
| Stale destination         | Real supervisory revocation after opening deposit modal; $1,000 deposit stayed central, warning visible, completed modal closed, reload did not repeat it. |

Before and after each first six steps, the measured aggregate cash was $5,394,306,676,867.324 in the retained accounting basis. Cash legs are checked against explicit mint/burn receipts where relevant. All 15 journals present after the first turn were applied. The bank also originated real NPC lending during that turn; its total loan book $139,221.6941494939 is therefore larger than the named player-requested loan.

## Governance, charter and manual approval

| Criterion               | Persisted result                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| US player ballot        | Actual Hold vote at turn 566, `auto=false`; six actual NPC rule ballots voted Hike. Rate remained 2.75 immediately after the player vote. The next actual committee phase resolved one meeting and changed one rate. The minority player ballot is not credited with setting policy. |
| Irish chair             | Actual rate command changed 4.75 to 5.00; last-change turn 566 and cooldown visible with further increase disabled.                                                                                                                                                                  |
| Charter capital         | Actual retail charter form debited corporate treasury 5,000,000, from 11,383,113.547948066 to 6,383,113.547948066. Exactly one applied journal recorded equal treasury debit and vault credit. The capital explanation was visible.                                                  |
| Additional funding      | Actual console funding command transferred 1,000 from corporate treasury to bank vault, leaving treasury 6,382,113.547948066.                                                                                                                                                        |
| Turn and read model     | Actual banking, solvency and committee phases ran at 567; active bank vault 6,487,928.443950341 was returned by the real read model.                                                                                                                                                 |
| Approval control        | Actual CEO console enabled `requireApproval=true`, with an explanation that requests wait without money moving.                                                                                                                                                                      |
| Pending request         | Actual borrower UI requested 10,000 at 3.75%; loan persisted pending, borrower treasury stayed 81,544.74431818181 and bank vault stayed 6,487,928.443950341.                                                                                                                         |
| CEO approval            | Actual CEO Approve command changed loan to current, credited borrower to 91,544.74431818181 and debited vault to 6,477,928.443950341.                                                                                                                                                |
| Approved loan servicing | Turn 568 reduced the new principal to 9,090.90909090909. The real banking hub returned this current loan and turn. All 31 journals were applied.                                                                                                                                     |

The synthetic player was explicitly assigned CEO authority over both synthetic corporations. This proves each authorization path under those appointments, not independent historical owners. The first 100,000 loan used direct origination; the second 10,000 loan proves the separate approval-required branch.

## Recharter exposure repair and actual Mongo continuation

The completed browser state exposed a real defect: reissuing a charter initialized its loan counter without surviving loans, although normal servicing credited those loans to the renewed bank. At turn 568 the counter was 67,013.92174453675 while actual current/arrears principal was 197,144.70680312152. The earlier UI journey is retained honestly with that discrepancy.

The repair initializes exposure from the same current/arrears book serviced by the bank, including named and NPC loans. Pending, defaulted, repaid and rejected loans are excluded. No cash, loan principal, rate, eligibility or estate policy changes. The original charter and settlement receipt generation are captured before reading the loan sum, then guarded at atomic publication. A concurrent funded loan or charter change rejects the stale intent instead of publishing an old sum. Focused interleaving tests exercise competing issuance followed by a real funded origination.

A new isolated copy of the completed browser state ran the production revoke, concurrent issue, lending and banking/solvency/committee paths on clean `b82b6e9051886eb546f803e4017185d6dd9feb3f`:

| Boundary              |             Counter | Actual current/arrears principal |
| --------------------- | ------------------: | -------------------------------: |
| Renewed charter       | 197,144.70680312152 |              197,144.70680312152 |
| Normal turn 569       | 208,992.79279975125 |              208,992.79279975127 |
| New funded 1,000 loan | 209,992.79279975125 |              209,992.79279975127 |
| Normal turn 570       |  244,959.6355550757 |               244,959.6355550757 |

Two simultaneous charter requests produced one success and one 5,000,000 capital debit. Before normal deposits returned, a new loan was correctly refused with zero lendable headroom and no balance/book change. The actual next turn supplied deposits from the normal household pool; subsequent credit succeeded. Named servicing and NPC resizing remain counted once. Final records contain 45 applied journals and one rejected intent with no applied legs, with zero unfinished settlements. The source database hash remained unchanged. No balance patch or replacement capital was used.

## Conservation and scope

The measured USD cash basis sums USD character wallets, corporation liquid capital and bank vaults, US external broad money and central-bank reserves, USD insurance cash and positive US treasury cash. Negative fiscal position is separately reported, not treated as spendable cash. The scenario uses USD corporations. Deposits and loans are liabilities/assets, not added to cash again. Each command and turn compares cash delta against explicit mint/burn receipts with a 0.02 tolerance. Cash remained approximately 5,394,306,676,867.324 throughout, with maximum displayed floating-point drift 0.001 and no mint/burn in these paths.

Initial fixture capital, capacity 250, underwriting revenue history, synthetic identities and government appointments are setup. Initial funding came from the retained household pool using real settlement. They are not credited as player UI actions. The later 5,000,000 charter capital and 1,000 funding are actual UI commands. Full economic stress and production banking activation remain outside this qualification.

## Reproduce

At a clean checkout with dependencies and Playwright Chromium available, use an isolated Mongo sandbox on loopback port 27018 and a new target name. `RETAINED_FINANCIAL_DB` selects the retained financial acceptance context; it must not name a live database.

```sh
SIM_MONGODB_URI="$SANDBOX_MONGODB_URI" npx tsx --tsconfig tsconfig.json scripts/sim/bankingBrowserJourney.ts --source="$RETAINED_FINANCIAL_DB" --target=ahd_sim_ui1328 --out=banking-ui.json
SIM_MONGODB_URI="$SANDBOX_MONGODB_URI" npx tsx --tsconfig tsconfig.json scripts/sim/bankingRecharterExposureReplay.ts --source=ahd_sim_ui1328 --target=ahd_sim_ui1328_recharter --out=banking-recharter.json
```

The browser runner disables background work, uses a loopback-only owned app, sets all database aliases to the same sandbox, and checks source/configuration and snapshots before any explicit resume. Its ephemeral synthetic authentication stays private. It stops its own browser/server after success; the qualification server was confirmed stopped. The explicit development harness flag retains route modules during long serial journeys; normal app configuration is unchanged.

[Sanitized browser results](issue-1328-player-journeys.json) include command snapshots, journal legs, audit action summaries and turn outcomes. [Recharter continuation](issue-1328-recharter-exposure.json) includes exact source hash, collection counts, conserved cash and canonical loan totals. No cookies, private filesystem paths, player identities or raw authenticated logs are published.

Focused validation: 10 banking component tests, 22 charter tests and 14 atomic settlement tests pass. Existing journal and NPC charter regressions passed earlier; the full final-head CI gate is recorded on PR2633. Development integration after these source-pinned runs preserves the separate merged journal recovery dispatches; no claim is made that historical browser commands reran on the integration commit.
