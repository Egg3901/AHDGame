# NPP sector founding cash witnesses (#2859)

## Defect and repair

The actual NPP decision processor can found a sector and reinvest in an existing one while logging only reinvestment. A native USD fixture spends 61,408,000 cash but records only 22,308,000 of reinvestment, leaving 39,100,000 of founding expense uncovered.

The repair carries the exact accepted founding charge out of the decision, in the corporation's native currency. Plants-mode charges include the existing entry fee and starter build; legacy founding uses its existing flat expense. No quote, decision, rounding, cash amount, borrowing outcome, capacity or constant changes.

When shadow accounting is explicitly enabled, the NPP cash operation writes an additive `nppFoundingCashWitnessKey` in the same update as its cash debit. The key reuses the business sector's id; observer bookkeeping consumes no extra business id. A single projected cohort read admits only matching stamps after the actual corporation bulk write. The observer publishes `corp_sector_founding` under the explicit `sector_founding_cash` reason, using the same observed stock valuation.

Publication runs in the cash writer's `finally` boundary. A failed ordered bulk can already have landed earlier cash writes; those exact stamps still publish. Rejected, unmatched or failed founding writes cannot publish. Stable ledger ids and upserts make repeated publication idempotent. Shadow failures cannot undo cash or mask the original authoritative-write error. Disabled shadow accounting adds neither a stamp nor a founding witness.

Reinvestment retains its existing separate accounting. This repair does not infer all spending from a corporation balance change or duplicate its existing capex entries. The additive stamp needs no backfill or new index.

## Verification

- The actual native decision processor and returned authoritative writes reproduce the missing 39,100,000 USD founding witness before repair.
- Focused real-writer, currency-basis, command-economy and cash-rail suites pass all 26 tests. The final founding-writer suite passes all 11 cases.
- Stateful actual processor cases reconcile plants and legacy founding in USD, EUR and JPY, including separate reinvestment. Coverage includes a lagging stored clock, explicit processing turn, disabled shadow accounting, rejected founding, failed cash writes, mismatched stamps, failed shadow publication and repeated publication.
- Native USD/EUR/JPY plants cases and EUR legacy founding preserve cash outcomes and reconcile actual primary cash movement. A native ordered-write failure after the founding debit still publishes that landed witness; retrying its publication adds no duplicate. Final native trial-balance and attribution results are recorded on the implementation PR.
- Matched native USD profiling measures 37 to 39 Mongo commands, 12,558 to 13,645 request BSON bytes, 5,022 to 5,382 response BSON bytes and 17 to 18 returned documents. Cash stays -61,408,000; entries increase from one reinvestment entry to two total entries, with zero final stock divergence. Audit logging is disabled in both measured fixtures to isolate cash accounting from its asynchronous audit buffer. These are bounded processor/writer command payloads, not full-world telemetry.
- The added turn work is one projected read and one ledger upsert batch for the whole founding cohort. It adds no per-corporation accounting query and reuses the existing behavior-config read and FX snapshot.
- Owned disposable native fixtures are removed after verification. Hosted delivery checks are recorded on the implementation PR before issue closure.

These are founding-observer qualifications. They do not prove every retained corporation or government finding is resolved, qualify full-world conservation under #968, or complete the #2159 release gate.
