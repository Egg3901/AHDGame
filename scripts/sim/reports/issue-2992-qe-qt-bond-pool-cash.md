# Issue 2992: QE and QT bond pool cash qualification

Runtime source: `0f76751e1d0fb5eec13bae26c0bc7385f93d5365`.

In the current-source twelve-turn cash diagnostic in #968 the EUR bond pool diverged on
every turn with cash above its ledger, cumulatively about 2.32B EUR. The pool's
lifetime counters showed `qeIn` 2,481,099,457 and `qtOut` 233,625,006 EUR beside
80,167,479 EUR of secondary purchases, now witnessed by #2967. Net QE plus those
purchases explains the gap at 0.998, as secondary trades alone explain NGN (1.017)
and with QE explain ITL (0.996).

Central-bank open market operations settle through the monetary operation journal. A
QE receipt mints the consideration into `bondMarketPools.cashLocal` and a QT receipt
withdraws it, but unlike the treasury advance in the same journal neither published a
ledger witness.

## Change

- A completed QE receipt publishes the exact consideration credited to the pool and a
  completed QT receipt the exact amount withdrawn, on `bond_pool:<currency>:<currency>`,
  valued like the balance snapshot, against named `central_bank_qe` mint and
  `central_bank_qt` burn contras.
- The witness rides the receipt's existing exactly-once witness projection, which is
  applied only to a completed receipt, so refused or refunded operations publish
  nothing and recovery never duplicates it.
- No price, quantity, money-supply rule or tolerance changes.

## Verified outcomes

The integration file runs three cases against the memory store and the same three
against an isolated local replica-set fixture. All 6 pass. Every reconciled fixture
has an unskipped stock check with zero divergences, a green trial balance and no
unattributed entries.

- QE into a GBP pool witnesses the exact consideration at the snapshot rate.
- QT from a GBP pool witnesses the exact withdrawal.
- A QT the pool cannot fund is refused with no cash change and no ledger row; with
  shadow accounting off QE still pays the pool and writes no ledger row.

With the witness removed, the QE and QT cases fail with one divergence each. The
crash-recovery cases now require exactly one witness per completed operation across
injected faults in bonds, pools and central banks. The money-supply, ledger,
transaction-log, bond and central-bank suites (80 files) pass: 718 passed and 21
native opt-in cases skipped. Scoped lint, formatting, semantic diagnostics for all 5
changed TypeScript files and the blocking architecture checks pass.

## Cost and scope

Each operation adds one exchange-rate read and one ledger insert when shadow
accounting is on. These native fixtures qualify the central-bank pool boundary, not
the whole world, so this does not clear #968 or the global cash gate in #2159. No
production database was reset or repaired.
