# Interbank realized-income journal qualification

Refs #1328, #2159. This completes the interbank income-projection adoption lane. The broader banking issue retains separate rollout and observation criteria.

## Executed source

- Baseline: `78e5600d5e2c201054166fc04eb53de6c29e37b2`, including the facility journal prerequisite from #2637.
- Treatment: `92be3347279d23a1b6e4e5d49c30799ca5b13e57`.
- Both checkouts were clean during execution. The companion JSON records the private fixture runner's hash. Later evidence and fixture-typing changes do not alter this game runtime. The inherited nullable cooldown read type also leaves its original query unchanged.

The final integration includes development `c5ff9130b77dcb2d515bd455a6eabc76b6ad8a76` after #2637 merged. The only merge conflict was the settlement-journal import list; the interbank recovery imports were retained. All six focused interbank phase regressions passed again. The recorded Mongo measurements remain attributed to the executed source above.

## Scope and results

Production `processBankingTurn` ran against isolated Mongo with ten synthetic investment banks and five USD interbank loans. Each loan has principal 48,000 and annual rate 10%, producing 100 interest per turn. Unrelated banking stages were explicitly pre-stamped complete at turn 300.

Normal cash and income match the baseline exactly: each borrower pays 100 from its initial 200 cash and records -100 realized income, while each lender receives 100 cash and records +100 realized income. Paid and received counters match the cash legs. Repeating the phase changes neither balances nor income.

Two actual-Mongo recovery cases cover full and partial payment, followed by two normal phase retries. Both converge to the original paid amount on each side with no unfinished journal records. Six focused phase-integration regressions passed, covering the loan update and both income projections.

The journal now owns income publication as well as loan advancement. Current-turn projection recovery requires every recorded cash leg to be complete. It does not resume another attempt's live cash legs or change the general earlier-turn recovery policy. Loan projection identity stays stable while its processing stamp changes, allowing acknowledgement recovery to find the same durable receipt.

## Performance

| Five-loan normal phase | Commands | Read BSON bytes |
| ---------------------- | -------: | --------------: |
| Baseline               |       78 |           4,934 |
| Treatment              |       89 |           4,934 |

The phase remains below the existing 1,000-command budget. Normal work adds one batch lookup of unfinished current-turn interbank records and journal bookkeeping for the two income projections per loan. Pending records read their original projections only during recovery.

Bytes count returned cursor documents, excluding transport headers. Best-effort audit batching may cross measurement windows. This synthetic subsystem fixture does not qualify a full world, real-liability activation, or production observation. Rates, cash allocation, arrears rules and default thresholds are unchanged.
