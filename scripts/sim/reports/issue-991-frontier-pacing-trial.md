# Frontier entry trial and bounded pacing repair

## Completed 48-turn diagnostic

Source `ac68753f4929faa7e15f11044066e570ec0e24bc`, 1991 start,
seed `issue991_frontier_pair_1991_20260930`, full normal turns 2 through 49.
Control run `3f36d9a6-75d6-4a1f-85a8-915164b931a7` disabled the frontier
experiment; treatment `e53da250-352c-4ae4-b589-36f71d8eb141` enabled it.
Both completed with 48 successful logs, 48 published vital-sign snapshots,
48 ledger reports, no failed or unreached phases and no collector errors.
They share source, seed and requested configuration apart from the experiment.
Fresh bootstraps generated different corporation identifiers, which affect
ordinary stagger slots. These are diagnostic comparisons, not estimates from
an identical-identity controlled trial.

All 867 US state-sector cells have demand observations at the terminal turn.
786 have positive local use in each arm. Complete counters, accumulated before
example sampling, supply the numerator and denominator.

| Terminal measurement                       |   Control | Treatment |
| ------------------------------------------ | --------: | --------: |
| Empty positive-use US cells                | 645 / 786 | 654 / 786 |
| Empty positive-use share                   |  82.0611% |  83.2061% |
| Marked experimental entrants worldwide     |         0 |         3 |
| Marked experimental entrants in US         |         0 |         0 |
| US ordinary-stagger rejection observations |     1,318 |     1,309 |

The required 10 percentage point coverage improvement failed. The measured
share worsened by 1.1450 points. Nigeria's recent twelve-turn country fill
fell from 39.7219% to 34.2510%, breaching the 5-point guardrail. Zero of the
four fragile commodities improved both seller-state breadth and fill over
that window. State counts are a supply-breadth proxy, not ownership groups.

| Recent twelve-turn median, turns 38 through 49 |  Control | Treatment |
| ---------------------------------------------- | -------: | --------: |
| Pooled fill                                    | 39.4390% |  39.7477% |
| Country-scoped fill                            | 28.6543% |  28.6732% |
| Physical sell-through                          | 97.3841% |  97.6197% |
| Labour staffing                                |     100% |      100% |

Every empty cell has one classification in every turn. All 26,799 control
and 26,732 treatment rejection observations have a named primary reason.
The current funnel alias is excluded from the 48 distinct turn documents.
Trial balance and money attribution are green in all 48 reports, with no
unattributed entries. First-turn stock-flow reconciliation is explicitly
skipped without a preceding balance snapshot. Among the 47 comparable
stock-flow reports, treatment findings increase on 17 turns. Terminal
findings decrease from 558 to 277 but do not satisfy the unchanged
nonincrease condition across turns. No pooled-fill, staffing or sell-through
tolerance is retrospectively invented for this diagnostic.

## Bounded pacing experiment

The prior experiment only offered second chances for profit, margin or a
nominal cash screen. It preserved the ordinary eight-turn corporation stagger.
Only three marked placements resulted, with none in the US. This trial does
not establish a coverage benefit.

The new experimental path may replace the ordinary stagger when the first
binding reason is `cohort_ineligible`, profit and margin already pass, the
candidate has no active supplier, and an output has finite positive calibrated
local use. Missing coverage and missing, zero, negative or nonfinite demand
cannot qualify. A failed profit screen cannot hide a pacing override.

The existing founding path still prices and debits real costs, preserves the
cash floor, and enforces logistics, policy, geography, deposits, glut and
retail-pause constraints. Ordinary placements consume the same experiment
slots. At most one experimental placement per state-country cohort and per
controlling entity can land per turn. There is no survival guarantee.
The experiment remains disabled by default and excluded from the all-flags
sweep. No production activation or financial migration is included.

## Verification

The production decision regression fails on the preceding source and passes
with the pacing opportunity. The focused decision, candidate, rule,
classification and entry-evaluation suites pass 54 cases. They retain the
ordinary flag-off path and reject unknown demand, covered markets, missing
coverage, masked unprofitability, unaffordable quotes and consumed slots.

Six native Mongo fixtures run the actual decision processor and authoritative
cash writer. Each currency uses the same synthetic inputs with the experiment
off or on and a corporation outside its ordinary stagger. No prices, capital
or facility costs are overwritten to obtain the outcome.

| Currency | Founded sectors, off/on | Additional real founding debit | Stock-flow / trial / unattributed findings, each arm |
| -------- | ----------------------: | -----------------------------: | ---------------------------------------------------: |
| USD      |                   0 / 1 |                     39,100,000 |                                            0 / 0 / 0 |
| GBP      |                   0 / 1 |                     31,280,000 |                                            0 / 0 / 0 |
| JPY      |                   0 / 1 |                  4,965,000,000 |                                            0 / 0 / 0 |

The remaining cash stays above the quoted floor in each treatment. The
comparison includes the unchanged reinvestment debit in both arms. All six
disposable fixture databases are removed after qualification.

The observed native decision and settlement calls use 34 commands off versus
38 on, 18 returned documents off versus 19 on. USD request bytes are
11,180 versus 13,855; cursor/reply BSON bytes are 4,903 versus 5,204. Added
commands execute the actual founding and its witness. The demand signal
uses already-loaded commodity documents; it adds no database read or
per-corporation query. These are bounded native fixture measurements, not
full-world performance or remote-latency evidence.

## Next controlled trial

Before queuing a new 48-turn comparison, use two isolated copies of the same
sealed opening world, retaining actor identifiers and all economic stocks.
Record full collection hashes and configuration manifests. Only the frontier
experiment bit differs. Capture the actual opening balance snapshot before
processing so all 48 stock-flow reports can compare consecutive balances.
Use the same source commit and RNG seed, normal serial worker admission,
and no concurrent full-world runs.

Acceptance keeps the issue's 10-point coverage improvement, at least 95%
explained rejections, complete classifications, no greater than 5-point
country-fill decline, no increased comparable stock-flow findings, and
improved breadth and fill in at least two fragile commodities. Preregister
5-point maximum declines for recent twelve-turn pooled fill, country-scoped
fill, staffing and physical sell-through before either new arm runs.
Missing observations fail qualification. Retain ownership-group breadth,
not merely seller-state counts. Actual dynamic largest-supplier-failure
qualification is required before activation; static exposure is insufficient.

The native fixtures do not satisfy those world-trial or supplier-failure
gates. Issue 991 and the broader launch gates remain open.
