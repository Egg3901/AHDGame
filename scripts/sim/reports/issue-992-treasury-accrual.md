# Treasury accrual qualification for #992 and #968

## Result and correction

All 23 retained budgets reconcile on each of 12 isolated treasury turns. Every country's native closing cash matches the unchanged baseline exactly on every turn. Baseline has 23 divergent government accounts per turn; treatment has zero, balanced entries and no unattributed fiscal flow. The correctly valued first-turn baseline discrepancy is 54,881,722,832.7475 anchor units.

**The original 23-budget monetary figures remain withdrawn.** They used a missing-rate 1:1 fallback. The intermediate 17-budget qualification used observed rates correctly. This fresh qualification extends it to all 23 budgets using 17 observed rates and six explicitly authored budget-only valuations. It does not rehabilitate the old figures.

## Accounting and compatibility

The actual native cash owner now stores a deterministic receipt with each accrual. Named components cover revenue, primary spending, debt service, enforcement and native rounding. Publication recovers a committed receipt after interruption; concurrent/repeated calls cannot apply the same accrual twice. Tax-base and holder-service statistics carry an explicit non-cash marker so they do not invent extra treasury movements.

Native fiscal accrual does not require an FX trade. With `ledgerShadow=false`, missing valuation leaves an explicit `anchorRate:null`, `anchorRateSource:"unpriced"` receipt. Native cash and retry behavior continue; no unpriced ledger entry is published. Turning shadow accounting on does not invent or backfill that old receipt's valuation.

With `ledgerShadow=true`, the entire active cohort is valued before any accrual. Missing active-currency FX and corrupt explicit FX reject without advancing any treasury. Valid observed rates win. Only an explicitly non-forex-active budget country with its own assigned currency can use an authored era valuation. Receipts retain the rate, observed/authored source and preset. This does not activate forex or provide a settlement-rate fallback.

## Authored 1991 prerequisite

Current seeding intentionally provides no tradable FX rows for the six budget-only countries below. Their 1991 valuation entries were narrowly extracted from existing Track 1 commit `609cf2bd7d`, read from integration commit `21570faf333cc5df5cc42137d0b6c72bcba4116e`. Only the six entries and the named Polish opening-rate constant were copied. Track 1 was not edited or merged wholesale; coordination is recorded in [PR #2397](https://github.com/Egg3901/AHDGame/pull/2397#issuecomment-5903826928).

| Country        | Currency | Authored local units per opening anchor |
| -------------- | -------- | --------------------------------------: |
| Bulgaria       | BGL      |                                   28.25 |
| Czechoslovakia | CSK      |                                  27.647 |
| Hungary        | HUF      |                        74.7353833333333 |
| Poland         | PLZ      |                                   9,500 |
| Romania        | ROL      |                                    34.7 |
| Yugoslavia     | YUD      |                                 13.5675 |

Existing World Bank, CNB, IMF, BNB and Federal Reserve citations and observation-date caveats are retained beside the constants. These preserve the original authored local-per-USD opening convention, where the 1991 starting USD anchor is 1. They are valuation references, not current tradable quotes. Missing authored values in other eras remain explicit; flag-off native accrual remains compatible and shadow qualification refuses unpriced accounting.

## Exact provenance and execution

- Treatment executable: `497780cf046c483f1d9a82eec8b84bcc374ae61b`.
- Baseline executable: `a70a1e53f7a6daa04659df7a4398b5cb46d692ce`, runtime `89b20b09716801d3d952d9a3698ffe08b2d23b0a` plus the identical runner only.
- The baseline runner imports only the treatment's six authored valuation denominators from its pinned output. Baseline runtime source and native fiscal math are unchanged.
- Retained completed run: `559d9701-e07f-48c8-ade1-294bc926820a`; generator `b4eb48872d6b17d64cd91a85202619f181797713`; saved turn 13.
- Full copied-selection digest before and after both executions: `5dfdc74d7da666c70ad252c0e7badaa3998fea93ea8ef6e7f6685d483b235f18`.
- Real treasury phases: turns 14 through 25. Other economic phases are held fixed.

The copy retains game state, all federal budgets, central banks, exchange rates, country runtime state and organization memberships. Both executions preserve those source selections. Real-Mongo rejection fixtures remove active USD FX or insert corrupt explicit BGL FX; both reject with every budget and the ledger untouched. A separate synthetic 1,234 USD bond-service statistic exercises the real bond emitter: it changes no cash and adds no treasury ledger entry after the repair.

No borrowing, debt-stock, interest, revenue or spending formula was changed. No compensation credit or tolerance change is introduced.

## Tests and measured cost

24 treasury integration tests and three valuation-map tests pass. Coverage includes concurrent calls, repeated calls, failure before/after receipt publication, next-turn recovery, signed overdrafts, debt service, enforcement, native rounding, marked versus genuine cash rows, invalid active rates, all six authored valuations, invalid explicit budget-only rates, and shadow-flag transitions. The earlier 120-turn fiscal-coherence fixture passed after explicitly seeding its historical SUR rate. Final repository CI remains a separate gate.

| Real treasury invocation | Baseline commands | Treatment commands | Baseline returned BSON | Treatment returned BSON |
| ------------------------ | ----------------: | -----------------: | ---------------------: | ----------------------: |
| First turn               |                44 |                 69 |          123,236 bytes |           124,227 bytes |
| Later turns              |                44 |                 92 |          123,236 bytes |     up to 136,285 bytes |

The default 500-command budget is unchanged. The first invocation adds two batched context reads and 23 receipt publications. Later invocations also recover/upsert the preceding 23 receipts. Measurement excludes copying, balance snapshots, reconciliation and retry probes. It measures this fiscal phase, not the full turn.

## Remaining acceptance

#992 and #968 remain open. This is a complete fiscal-phase qualification, not the authoritative whole-economy 12-turn gate. Other account classes and cash writers remain separate acceptance work. Old unpriced global-inventory magnitudes are excluded from this report.

Machine-readable results: [issue-992-treasury-accrual.json](issue-992-treasury-accrual.json).
