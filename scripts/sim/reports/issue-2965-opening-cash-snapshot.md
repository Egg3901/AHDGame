# Issue 2965: opening cash snapshot qualification

Runtime source: `b1ec98a60eecbe491bcba729ff51e742fea96781`.

The current-source twelve-turn cash diagnostic reproduced a skipped first stock
reconciliation. The harness entered the turn loop without the predecessor cash
snapshot. The reconciler correctly left that check unverified.

The harness now captures actual opening stocks after setup and before advancement.
It records the snapshot identity in run metadata, preserves existing snapshots on
resume, and fails the run before advancement when storage or validation fails.
The shared writer can swallow storage errors; a confirming read makes admission
independent of its ambiguous account-count result.

## Verified outcomes

The focused suite passed all 18 cases: 11 memory cases and seven native Mongo
cases. Native cases use isolated fixture namespaces and the actual treasury,
snapshot and reconciliation code. Only database selection and injected storage
failures are substituted.

- Without opening capture, actual treasury movement reproduces the skipped check.
- With capture, treasury cash moves from 2825 to 5650 using the authored budget
  valuation. Stock reconciliation is unskipped with zero divergences, trial balance
  is green, and unattributed entries are empty.
- An unexplained cash increment followed by resume preserves the original snapshot
  and exposes one divergence rather than replacing the evidence.
- A failed opening write prevents admission while cash and ledger remain unchanged.
- A lost acknowledgement after persistence recovers the actual stored snapshot;
  retry preserves its identity and subsequent cash reconciles.
- Corrupt existing balances are refused without replacement.
- A genuinely empty persisted world remains distinct from failed capture.
- Four invalid clock values are refused before snapshot creation.

Focused lint, formatting and semantic diagnostics for all three changed TypeScript
files passed. The full merge gate runs on the final pull request head.

## Performance and scope

Capture runs once at startup, outside `processTurn`. It adds an initial lookup,
the existing batched snapshot collection/write, a confirming lookup and run metadata
write. Resume reads the prior snapshot without recapturing cash. No turn phase,
formula, monetary amount or reconciliation tolerance changes.

These native fixtures qualify the missing-opening defect, not the entire world.
The original twelve-turn diagnostic retains actual later stock discrepancies.
No production database was reset or repaired. No final-release acceptance is claimed.
