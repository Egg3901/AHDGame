# Savings lifecycle reconciliation for issue 1328

Date: 2026-09-30.

## Reproduced failures

- Opening savings returned success and set the legacy flag without creating an
  authoritative account until the first later deposit or withdrawal.
- Retirement and account deletion left savings accounts and holder liabilities
  referencing deleted characters.
- A rounded full-withdrawal request within the existing floating-point tolerance
  could settle more than the exact claim and leave a tiny negative balance.

## Verification

The affected savings, opening-route, deletion, retirement and changelog suites
passed **121 tests across 14 files**. State-based tests cover bank and central-bank
backing, interrupted cash transfer and retry, refusal during holder resolution,
insufficient bank cash followed by a funded retry, and preservation of the owner
when closure cannot finish.

Executable source `4e985b6ded` was replayed against an isolated, projected snapshot
at turn 1239. Subsequent string-id type annotations do not alter settlement logic.
Source reads used a read-only snapshot transaction. No production data was changed.
The reproduction retained 312 character projections, 134 savings accounts,
14 bank-charter projections and 24 central-bank projections.

| Measurement                                   | Before | After | Repeated apply |
| --------------------------------------------- | -----: | ----: | -------------: |
| Savings comparison discrepancies              |     20 |     0 |              0 |
| Opened empty accounts without account records |      7 |     0 |              0 |
| Accounts whose owners were already deleted    |      8 |     0 |              0 |
| Negative rounding residues                    |      1 |     0 |              0 |

The dry run changed no retained document. Apply left every character wallet,
bank cash reserve and central-bank external cash pool unchanged in this cohort.
A repeated apply left the entire retained snapshot unchanged. Synthetic bank-held
closure tests separately prove a real backing transfer and recovery without a
second debit.

One historical claim, approximately USD 0.21, had neither an owner nor a bank.
The repair refuses that write-off unless the operator explicitly accepts it and
records the amount on the closed historical account. An existing owner's claim
at a missing bank is never written off by this repair. Rounding repair applies
only to an existing negative residue no larger than the prior `1e-9` withdrawal
tolerance; it does not relax the reconciliation threshold or hide larger losses.

## Deployment scope

The migration command is read-only by default. Apply requires authoritative
savings for every affected currency and no pending banking settlements.
Missing-holder write-offs require a separate explicit flag. The schema additions
are optional, populated when a closure is claimed or a historical loss is recorded;
existing accounts require no blanket schema rewrite.

This resolves the reproduced lifecycle defects. It does not close issue 1328:
the production observation window, remaining player journey and legacy retirement
criteria still require their own evidence. This is a bounded subsystem replay,
not full release-world qualification for issue 2159.
