# Issue 2158: simultaneous modern-crisis qualification

## Scope and provenance

This qualifies the program's aggregate overlap criterion. **The full 1991-2027 worldsim horizon remains pending.** This is an explicitly constructed concurrent scenario, not a historical trajectory, a new complete-world run, or an estimate of how often these crises coincide.

[Runner](../crisisOverlapReplay.ts), [composition loader](../crisisOverlapSetup.ts), [measured results](issue-2158-crisis-overlap.json).

Executed clean source: `022ec0bc3e859e40fc850d6dc993886217968422`, based on integrated development `5e072ac0c3f107ffffa2decd0b190cf1eace6156`. Two isolated copies each advance 48 subsystem turns. One is the crisis-disabled control; the other runs all seven families together at a counterfactual 2027 clock. Source content hashes are rechecked after completion, with zero source writes.

The economy combines five retained regional cohorts (US, Germany, Ireland, UK and Turkey), fourteen retained background economies, and 315 retained corporate records. Poland has no available regional cohort and is not fabricated. These bounded samples do not claim worldwide output, population, query cost or fiscal forecasting.

Inputs are disclosed rather than treated as a single historical save:

- Regional populations and background economies come from completed 2027 control run `a2b5adb8-dd9a-4480-8781-50befc0fd53d`, executed at `47bb364e1f605c895d186e51f6a19b6ed4de5ff3` for 48 full-world turns.
- Financial stocks come from the accepted #2154 replay at `1184cdd81dd0da3b7137afac72496a80a681c77d`. Its documented, already executed 6 million German loan default is re-anchored as a recent credit-history observation. No loan, treasury balance or bank balance is changed to create this fixture. This is a synthetic recency assumption, not a newly executed default.
- The accepted #2156 prolonged-war result supplies Ukraine state; its overlap result supplies terrorism state. The accepted #2155 inaction result supplies pandemic state. The accepted #2157 war/recovery target supplies independent Arab origins and residual displacement.
- Northern Ireland retains its unresolved opening state. The dormant Balkan definition is explicitly opened at its initial phase for the concurrent-pressure fixture, without assigning war, damage, authority or consent.
- The seven records are normalized and asked to emit their phase-entry windows on the replay clock. Existing consequences and commitments remain intact. Other historical definitions are closed in this fixture to keep the measurement scoped to the seven program families.

## Concurrent response load

All seven families share the ordinary `processLivingConflictsTurn`, event materializer and expiry resolver. Public responses are deliberately left unanswered; **actual player decisions are zero**. No office holder, referendum result, bill or public mandate is invented.

| Family                  | Windows in 48 turns |
| ----------------------- | ------------------: |
| Northern Ireland        |                   2 |
| Balkan dissolution      |                   2 |
| Transnational terrorism |                   2 |
| Financial crisis        |                   2 |
| Arab uprisings          |                   2 |
| Russia-Ukraine security |                   2 |
| Pandemic                |                   4 |

Peak simultaneous windows are **7**, with **at most one per family** at every step. There are 16 windows total and 9 expiry resolutions; 7 windows remain active at the endpoint. The highest country-level invitation count is 7 (UK and Ireland). This is an upper bound on simultaneous country windows, not seven actions required from one player or proof that every office is eligible for every node.

All 48 same-turn shared-driver retries preserve stored conflict state. Generic lifecycle closure also clears the remaining sequential interaction node; every closed crisis is checked for orphaned open panels. The unanswered defaults create no national choices and leave every retained federal budget document unchanged.

## Combined consequences through actual consumers

Each copy invokes the ordinary metric engine, demographic flows and background macro processor every turn, plus commodity pricing every twelve turns. Pandemic mortality changes real cohort and working-age stocks; the next metric turn reads those stocks. War and host exposure then constrain available labour and output. Observed credit loss changes household demand through the commodity pipeline.

- The combined copy ends with **71,994 fewer people** and **37,507 fewer working-age people** than the control. These are paired population-stock differences, not a claim that all differences are deaths. Annual pandemic excess mortality peaks at **0.571015%**, below its 1.2% model cap.
- Background macro output reaches **78.274760%** of the same-country, same-stock kernel output. Comparisons are taken only on each country's real six-turn macro tick.
- Displaced labour exposure reaches **2.4%**; combined host exposure reaches its **0.5%** cap. All origin/host exposure records remain within the shared 10%/0.5% bounds, with infrastructure damage at most 1. The output constraint including bounded Arab sanctions cannot fall below 68.02% of the unmodified same-stock kernel under these formulas.
- Arab external refugee exposure equals the sum allocated to hosts at every turn. Exposure does not create additional population stocks.
- German credit demand reaches **0.9999869511134952**, then returns to exactly 1 after the recent-credit window expires. At turn 2000, the actual household-demand kernel produces **27.3244629772 food units**, versus **27.3245263960** with only the credit impulse removed. The shock is small at the retained economy's scale.
- Regional GDP stays positive and finite, and unemployment remains within 0-100. GDP comparisons are reported separately by region because native currency stocks must not be summed across countries. The measured differences include the normal coupled metric response; they are not a causal decomposition assigning every change to one crisis.

| Sampled region  | Final GDP relative to its paired control |
| --------------- | ---------------------------------------: |
| AK (US)         |                               99.849719% |
| BB (Germany)    |                               99.601375% |
| COR (Ireland)   |                               99.848575% |
| EAE (UK)        |                               99.849114% |
| TR_ANK (Turkey) |                               99.610795% |

The report's JSON records region-level GDP ratios and population paths. No direct GDP patch, population patch or silent cash injection supplies these effects. The accepted child reports remain the evidence for actual rescue/default settlement, active policy costs, ballots, sanctions enactment, battle outcomes and recovery routes. This report tests their simultaneous consumers and ignored/default window load.

## Query work

Maximum Mongo command counts per measured invocation are: shared seven-family driver 97, expiry 17, credit demand 4, commodity 58, metric engine 40, demographic flows 10 and background macro 4. Maximum returned cursor BSON is recorded alongside each count in the JSON. These are bounded sample measurements, not a full worldwide turn benchmark.

No gameplay formulas or production code are changed by this qualification. Final repository CI is required in addition to the completed replay.

## Reproduction

Use the three retained sandbox inputs named in the measured provenance and a new target prefix:

```sh
SIM_MONGODB_URI=mongodb://127.0.0.1:27018/ npx tsx --tsconfig tsconfig.json scripts/sim/crisisOverlapReplay.ts \
  --source="$RETAINED_CONTROL_DB" \
  --finance="$QUALIFIED_FINANCIAL_DB" \
  --arab="$QUALIFIED_ARAB_RECOVERY_DB" \
  --target=ahd_sim_crisis_overlap \
  --out="$REPORT_FILE"
```

The runner refuses non-sandbox URIs, source/target collisions, populated target databases and dirty acceptance source. It creates separate `_control` and `_combined` targets, preserves all input collections and pins its source commit through completion.
