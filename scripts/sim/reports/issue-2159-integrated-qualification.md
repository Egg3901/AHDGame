# Integrated source for 1991 qualification

Refs #2159, #2158, #2488 and #2124. This branch combines delivered code for
qualification; it is not a launch approval or a completed horizon report.

## Source

- Published Track 1 source: `57ed191438c44656e47402b7d695c9ddf6d6d5e0`.
- Development source: `69b83f850c87c172da8b8ff664628f27dfe1278c`, followed by
  migration compatibility delivery `56b969b464488ddf615caf4a1e528027bf2b0844`.
- Combined runtime: `c931f69969da75280d30d21b3f78f439f689c452`.

This gives one source both the Track 1 successor seed modules and the current
seven-crisis implementation, accounting repairs, election receipts and recovery,
producer bootstrap, telemetry, and explicit reset target selection. Existing
source pins and active worlds are unchanged.

## Resolved integration conflicts

1. Sovereign issuance retains current recoverable primary-financing settlement
   and the Track 1 explicit country/currency lookup. The older local pool counters
   are superseded by the shared settlement path. The Irish EUR regression now
   observes the current per-bond persistence boundary instead of the removed
   bulk insertion.
2. German election resolution retains the current retryable AMS helper, including
   resetting failed reconciliation to completed for retry. Track 1's Bulgarian,
   Hungarian and Russian resolution additions remain present. The older swallowed
   AMS failure path is not restored.

An automatic merge would also label the incoming Bulgarian D'Hondt and Hungarian
mixed mandate paths as generic Hare allocation. Their optional tally receipts now
record `dhondt` and `hu_mixed`; existing receipt-less history stays unknown. The
standing report accepts those executed-path names without inferring historical
paths. No allocation formula or seat entitlement changed.

## Verification and limitations

125 focused tests passed across sovereign issuance, actual persisted primary
funding, general elections and the standing turnover report. The incoming Irish
test first reproduced the obsolete insertion expectation; the corrected boundary
assertion passes while retaining EUR denomination checks. New receipt assertions
verify both country-specific executed paths.

The later development merge was clean and adds the already verified migration
compatibility delivery. Initial integrated CI found a duplicate declaration of
Poland's opening currency parity: the development extraction and Track 1's shared
data import both used the same name and value. The duplicate local declaration
was removed, preserving the shared 9,500 parity. All 13 focused currency and Polish
fiscal data tests pass. Full integrated CI remains required before this source
is used for a new sandbox bootstrap. Bootstrap conformance and the 1991 through
2027 horizon are not yet qualified. The Track 1 federation application and other
open #2488 criteria are not completed by resolving Git conflicts.
