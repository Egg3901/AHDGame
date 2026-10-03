# Selected 1991 player journey rehearsal

Issue: #2159. Completed October 3, 2026, UTC.

**Application source:** `9af1c8ea56287629b426b27bbf52cf58da49ed06`.
The registered source worktree remained clean throughout qualification.

This completes the operational checklist row for login, character creation,
office claiming, elections, actions, economy, banking, funds, crises, wire,
and admin surfaces. It does not complete the financial product, country
conformance, stress, or final release worldsim gates.

## World and method

The browser used a separate restored sandbox copy of the selected
`1991-default` world, at turn one with NPP autonomy `v4`. US, UK, and JP
started with no parties and still had zero parties after the rehearsal.
The ordinary synthetic player remained Independent and never received admin
permissions. A separate synthetic administrator exercised admin reads.

Commands went through the real browser UI and application routes. Mongo
readbacks checked persisted state; subsequent page and API reads checked
the resulting read models. No production database was reset or written.
The browser copy was not admitted to a simulation worker, and development
background processing was disabled.

The world stayed at turn one. The fundraise used a guarded active command
window in this isolated copy, then the copy was paused again. All other
commands ran with the world paused.

## Verified journeys

| Surface            | Evidence                                                                                                                                                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Login              | Ordinary-player UI login returned 200; authenticated player routes and account reads succeeded.                                                                                                                                                                                                                                                                    |
| Character creation | UI creation returned 201 for an Independent US character in California. The returned character matched the persisted active character and loaded profile.                                                                                                                                                                                                          |
| Elections          | The ordinary player filed through the Senate race UI. POST returned 200, exactly one Independent candidacy persisted, and the race page displayed its withdrawal control.                                                                                                                                                                                          |
| Office claiming    | The actual filed race was completed with a disclosed synthetic positive vote tally through the real general-election resolver. The official, character office, finalized tally, and resolved election persisted. Replay did not duplicate the official. The profile showed the Senate office, and the California class-one seat disappeared from the vacancy list. |
| Actions            | A paused-world attempt returned 409 without changing cash or points. The subsequent active-copy fundraise returned 200: action points 25 to 22, campaign cash $89,520 to $107,023, personal cash unchanged. The UI displayed the resulting campaign balance.                                                                                                       |
| Economy            | The US economy page loaded actual opening economic data, including GDP and inflation. This is an operational read check, not a macroeconomic stability result.                                                                                                                                                                                                     |
| Banking            | One UI deposit of $1,000 and one withdrawal of $250 returned 200. Wallet $999,250, savings $750, holder, audit entries, refreshed banking API, and account UI agreed.                                                                                                                                                                                              |
| Funds              | The US Large-Cap 25 Index accepted ten units for $1,000. Five units were redeemed immediately for $500; five remained. Wallet, position, fund cash, unit supply, and refreshed position UI agreed.                                                                                                                                                                 |
| Crises             | The fully loaded API and page agreed on the 1991 turn-one opening state: zero active and zero resolved crisis records. Loading placeholders were not counted as successful reads.                                                                                                                                                                                  |
| Wire               | One free article was posted through the UI, persisted once, displayed in the feed, and returned by a fresh feed read. It did not spend cash or action points. Publication existed only in the isolated copy.                                                                                                                                                       |
| Admin              | A separate synthetic administrator logged in, loaded the dashboard, and read protected feature configuration. The protected API returned 200 for the administrator and 403 for the ordinary player. The world remained paused.                                                                                                                                     |

## Accounting and selected contracts

The fund subscription and redemption generated four new ledger entries.
The real ledger reconciler, using before and after balance snapshots, reported
zero stock-flow divergences, a green trial balance, and zero unattributed
entries. After these commands, the ordinary player held $998,750 personal
cash and $750 savings.

The selected savings mode resolves to `off`, the legacy pointer savings
contract. Wallet plus savings was conserved. The bank's cash and deposit
book correctly remained unchanged under that contract. This does not qualify
authoritative cash-backed savings activation.

Fundraise reconciliation also reported zero divergence, green trial balance,
and zero unattributed entries. Its campaign balance is outside the personal
cash stock basis; this does not assert global campaign-money conservation.

## Fixture and harness boundaries

- Office handover used accelerated race completion and 100,000 explicitly
  synthetic votes. No world turns advanced. This verifies the office write and
  resulting UI path, not competitive swing or long-horizon election behavior.
- The native CJS harness could not load the resolver's dynamic achievement
  alias. The actual auxiliary callback was resumed separately; the Senator
  achievement persisted once and remained single after another callback.
  Office resolution was not repeated to repair this harness gap.
- The first creator probe failed on an ambiguous nested `main` locator after
  the 201 response. Persisted ownership and later profile reads recovered the
  check without creating another character.
- A landed deposit and subscription were not replayed when their probes
  stalled on dialog or transient-message waits. Recovery continued with
  withdrawal and redemption only, guarded by persisted balances and units.
- Cold development compilation failures were excluded. The completed journey
  used development route compilation, not a production performance benchmark.
- The administrator fixture initially omitted the required role claim. Its
  malformed token was rejected; the fixture was corrected and reauthenticated.
- Browser coverage used a desktop viewport. Decorative images and external
  requests were blocked. Mobile layout and visual asset availability are not
  qualified by this report.

Twelve source-linked receipt files, browser captures, and the combined
qualification readback are retained privately. Raw credentials, tokens,
database connection details, and account identifiers are excluded here.
Every enabled financial product, the applicable crisis horizon, and the
exact final release simulation matrix remain separate required checks.
