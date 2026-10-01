# Organization cash witnesses (#2854)

## Defect and repair

An actual native UN dues payment changes a member treasury from 1,000 to 940 and its organization fund from 1,000 to 1,060. Before this repair it produces no ledger entries, and fund cash is absent from authoritative balance snapshots. The treasury movement is an uninstrumented stock-vs-flow finding.

This repair includes `organizationFunds.balanceLocal` in native-currency snapshots and witnesses actual successful dues, funded tribute, fund capitalization, aid, spending and refund writes. It adds `org_cash` for attributed organization cash movements and `org_tribute_mint` for the existing explicit tribute from entities without a modeled treasury. The latter uses a separate `organization_tribute_unmodeled` reason.

Existing conversions, rounding, treasury debt behavior, guarded fund debits, economic constants and cash outcomes remain unchanged. Witness valuation matches each authoritative stock snapshot, including treasury-specific anchor valuation. Mixed-currency conversion differences remain visible rather than being forced to net to zero.

Snapshot currency follows the stored currency country, then the built-in or custom founding country, then the established US fallback. Only stored `balanceLocal` is counted. Legacy `balanceUsd` remains a UI fallback; this observer neither migrates it nor manufactures opening cash.

Turn shells preload one projected accounting context for their cohort and pass the processing turn explicitly. Cash helpers publish a batch for a dues, tribute or aid operation. Landed writes are flushed even if subsequent work throws. Alignment refunds publish in one phase batch. Direct calls retain immediate witnesses. Shadow accounting requires an explicit flag in the same database, and shadow insertion failures cannot undo successful cash writes.

## Verification

- Eight new actual-writer USD/EUR regression cases fail before repair: missing fund snapshots and missing dues, aid, spending and refund witnesses.
- Initial repaired writer, fund, tribute and aid suites pass 38 tests.
- Membership funding, organization-phase and influence-command suites pass 24 tests. The alignment suite passes 61 tests after moving its cold import into module setup. Existing mock assertions are updated for the explicit preloaded-context argument.
- Guard coverage exercises rejected and zero movements, disabled shadow accounting, failed authoritative writes, failed shadow insertion, flushing a landed debit after a later failure, cohort batching, explicit processing turns, legacy fund currencies, mixed-currency stock valuation and funded versus unmodeled tribute. The final observer, derivation, reconciliation and budget-valuation suites pass all 54 tests.
- Native Mongo fixtures execute five real actions per USD/EUR fund: dues, aid, spending, refund and capitalization. Both sources finish with treasury cash 990 and fund cash 1,010 in each currency. Before repair there are zero ledger documents and two government divergence findings. After repair there are 16 ledger documents, zero divergence, zero trial imbalance and zero unattributed movements.
- A native 1953 tribute fixture charges one treasury-backed member and one macro member. The existing result is 1,000,000 fund currency collected, with 500,000 explicitly minted. Three witness entries reconcile with zero divergence, imbalance or unattributed movements. A subsequent disabled-shadow fund debit produces no new entry.
- Bounded native profiling of the ten-action fixture measures 32 to 54 Mongo commands, 8,200 to 18,056 request BSON bytes, 3,032 to 5,903 response BSON bytes and 12 to 30 returned documents. The added cost includes projected accounting context and ten batch/direct witness inserts. Aid, dues, spend and refund use shared context; standalone domestic funding resolves its own context. These are command payloads for the bounded fixture, not full-world phase telemetry. No per-member accounting query is added to the turn cohort.
- Each owned native fixture is removed after verification. Hosted delivery checks are recorded on the implementation pull request before issue closure.

These qualifications cover the organization cash observer. They do not establish a new full-world conservation result, eliminate every retained government/corporation finding, or qualify #968/#2159 release readiness. Existing incomplete transfers retain their actual outcomes and visible cash movement; this repair does not silently compensate them.
