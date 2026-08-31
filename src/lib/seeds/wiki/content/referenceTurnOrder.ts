export const referenceTurnOrderContent = `# Reference: turn order

The game runs on an hourly cron. Every real-world hour is one game turn, which is one game week. Turn processing runs through roughly a dozen top-level adapters that together call over 100 phase steps, each hour. This page lists the major groups of phases, what runs in each, and why the ordering matters.

**1 turn = 1 game week = 1 real hour**
**48 turns = 1 game year**

---

## Turn sequence overview

| Group | Phases | Key constraint |
|---|---|---|
| 0. Housekeeping | Release shares held by banned or inactive shareholders; **cold-war tension** relaxes toward its pressure floor | First, so everything downstream reads the current temperature |
| 1. Resources | Action refresh, fund generation, corporation turn (production, clearing, freight, marketing settlement), unions and NPP union behaviour, party influence, caucus tax | Parallel-safe |
| 1a. Finance | NPP funds, savings interest, NPC bank policy, **banking** (deposits, loans, runs), pensions, prospecting resolution, macro country turn, bond coupons and maturities, commodity prices, extraction-contract settlement, line of credit, share-price recompute, bank solvency, financial suspect scan | After corporations (bonds need updated liquid capital) |
| 2. Demographics | Turnout decay, party GOTV, party org maintenance, registration drift, pressure decay, priority-region decay, support decay and accrual, party tier (Major/Minor) | Sequential |
| 3. Party elections | State/national/committee elections, party action generation, charter expiry, empty party cleanup, coalition disband votes, NPP relationship maintenance | Parallel then cleanup |
| 4. NPP behavior | NPP bill sponsorship, challenger generation, election entry, bill voting, endorsement sweeps | Uses shared NPP context |
| 5. Bills, courts & cabinets | Bill lifecycle, state bill timers, cabinet nominations, **Supreme Court** turn (docket and surprise cases), UK surprise cases, social-axis drift | Parallel-safe |
| 6. Campaigns & events | Campaign turn, player random events, world events, NPP action processing (every 4 turns), activity logging | Sequential |
| 7. Election resolution | Candidate party sweep → primary resolution → vote accumulation → campaign spend reset → timer advancement → primary snapshots (ballot accrual) → general resolution → clear resolved support → leadership vacate | **Strictly sequential: ordering is load-bearing** |
| 8. Parliamentary government | Government formation, no-confidence and confidence votes, PM vacancy watcher | After election resolution |
| 9. Election coverage & diplomacy | Perpetual elections, by-election watcher, leadership elections, stale-candidate cleanup, inactive-candidate withdrawal, auto-reelection entry, **international organizations** (votes, treaties, foreign-policy planner), **alignment** and spheres, **settlement** crises (the German Question and its kin), impeachment lifecycle, presidential succession | Parallel-safe |
| 10. Fiscal year | October processing (turn 40 of 48) | Conditional |
| 11. Effects & metrics | Policy effects, demographic effects, policy-reaction and archetype-approval decay, unowned sector growth, metric decay, investor-confidence decay, state-ownership concentration, subsidy budget, regional budgets, crisis turn, **naval and air operations**, **ministerial orders (this is where battles resolve)** | Naval/air runs before battles so a battle reads this turn's sea control, air superiority and supply |
| 12. National aggregation | Metric engine, demographic flows, **census**, era crossing, metric activation, national metrics, fiscal base growth, economic model, trade growth mirror, inflation recalc, **command economy**, Forex, central bank chair turn, **FOMC meetings and nominations**, NPP monetary operations, chair removal and selection, independence desire drift, referendum lifecycle, party member-count reconcile | After state effects |
| 13. History | Metric, approval, interest-rate and party snapshots; portfolio, corporate portfolio, stock exchange, investor ranking and wealth-list snapshots; game health; audit anomaly and suspicious-activity scans; money-supply, ledger balance and reconciliation snapshots; economic vital signs | Parallel-safe |
| 14. Persistence | Increment turn counter, save turn log, send live update | Not wrapped in try/catch |

Country-specific election phases (UK by-elections, JP Sangiin half-elections, DE Landtag cycles, and so on) run inside group 9 as their own named steps.

---

## Group details

### Group 1: resources

Runs at the start of every turn, in parallel:

- **Action refresh**: All player characters receive base 4 actions per turn (plus any office bonuses from game settings). NPP actions also refreshed.
- **Fund generation**: Player characters receive passive income from held offices (state taxes + national taxes). Party treasuries receive contributions.
- **Corporation turn**: Sectors produce, clear, and settle freight and advertising; corporations pay dividends and income to character shareholders.
- **Unions turn**: unionization drifts, strikes trigger and resolve, collective agreements run.
- **Party influence turn**: Bonus actions from party influence are merged with the refreshed pool (runs after action refresh, cap enforced).

Before any of this, the **cold-war tension** phase relaxes the world's shared gauge toward its standing pressure floor, so every later phase reads the current temperature.

### Group 1a: finance

Runs after corporations so bond coupon flows can read updated liquid capital:

- **Banking turn**: private banks take deposits, lend, pay insurance premiums and face runs; bank solvency is scored afterwards.
- **Pension turn**: union pension schemes collect contributions, accrue claims and pay benefits.
- **Prospecting resolution**: geological surveys complete.
- **Bond turn**: Sovereign and corporate bond coupons paid; matured bonds settled (principal in one lump); defaults processed.
- **NPP fund generation**: NPPs receive passive income (if enabled).
- **Line of credit turn**: Interest accrues on outstanding credit; auto-pay from this turn's income.
- **Savings interest turn**: Interest credited on savings balances.
- **Commodity prices and contract settlement**: Commodity price indices updated, then extraction-contract royalties settle at those prices.
- **Share-price recompute**: fundamental values refreshed.
- **Financial suspect scan**: Automated fraud detection runs after all financial phase emissions.

### Group 2: demographics

Sequential (each step depends on the previous):

1. **Turnout decay**: All turnout modifiers decay 2% of their current value toward zero.
2. **Party GOTV**: Party GOTV budget distributed to states, boosting turnout modifiers for aligned demographics.
3. **Party org maintenance**: Cap-contribution rates applied; Org decays by a small fixed rate each turn for any party with Org above 0.

### Group 3: party elections

Party leadership elections, national committee elections, and committee assignments all run in parallel. Then:

- **Empty party cleanup**: Parties with zero members and no default status are deleted (cascade across 13+ related collections).
- **Coalition disband votes**: Expired coalition disband votes resolved.

### Group 4: NPP behavior

NPPs run their autonomous decision logic:

- **NPP bill sponsorship**: with autonomy on, NPPs table bills aligned with their party's agenda.
- **NPP election entry**: deterministic and priority-ordered, not a dice roll. Seat-holding incumbents defend their primary first, then each party fills at most one generic NPP into each open primary, in a fixed race-priority order. Under the higher autonomy levels an occasional ambitious challenger may also enter an already-filled primary. See [NPP Elections](/wiki/npp-elections).
- **NPP bill voting**: NPPs vote on active bills through the cross-pressure model (ideology, whip, district, donors).
- **Endorsement sweeps**: player endorsements are reconciled against party changes. US congressional leadership races are player-only; NPPs do not vote in them.

### Group 5: bills & cabinets

All parallel:

- **Bill lifecycle**: Bills advance through floor votes and executive signature. Bills that expire are marked failed.
- **Country-specific bill phases**: UK Parliament enactment, DE/JP specific bill phases.
- **State bill timers**: State-level bill deadlines advanced.
- **Cabinet nominations**: Presidential/PM cabinet nominations processed; acting appointments lapse at 24 turns.
- **Supreme Court turn**: scripted seat turnover on the calendar year, docket cases and surprise cases decided by the sitting bench.
- **Social-axis drift**: a country's social baseline drifts toward the stance of its enacted laws.

### Group 6: campaigns

- **Campaign turn**: Each active campaign receives income (based on fundraising level), generates campaign actions (based on endorsements), pays maintenance, and applies passive effects (media spending favorability, opposition research debuffs, travel presence bonuses). The final-4-turn 2× season multiplier applies here.
- **Player random events and world events**: pending event offers resolve, new ones are offered, and world-event and high-tension offers go to heads of government.
- **NPP action processing**: NPPs execute queued actions (runs every 4 turns only).
- **Activity logging**: Turn summaries are recorded for the activity feed.

### Group 7: election resolution (strictly sequential)

This is the most critical group. The phases must run in this exact order. Reordering produces incorrect election results:

1. **Candidate party sweep**: Candidates whose party no longer matches their candidacy are auto-withdrawn (party switches).
2. **Primary resolution**: Primaries that have reached their end time are resolved. Down-ballot races read the cumulative primary ballots and the top count per party advances (the score path only where a party cast no ballots); presidential races read pledged delegates and, on the reworked ruleset, run the convention. Others are marked withdrawn.
3. **Vote accumulation**: General elections accumulate votes for this turn from the registered electorate. MUST run after primaries (eliminated candidates are excluded) and BEFORE timer advancement (so the final turn's votes are captured). A turn that is re-run after a stall does not bank the same slice twice.
4. **Election timers**: Countdown clocks advance; elections that have reached their end time are marked "completed."
5. **Primary snapshots**: Standings are recorded for every open primary and, once a race's closing window has opened, that turn's slice of primary ballots is accrued.
6. **General resolution**: Elections marked "completed" are fully resolved: winners determined, elected officials updated, characters receive office, next cycle spawned.
7. **Leadership vacate**: Members who lost seats, changed chambers, or won a different office have leadership positions removed.

**Why the order matters:** If vote accumulation ran after timer advancement, final-turn votes would be lost. If primaries didn't resolve before vote accumulation, eliminated candidates would still receive votes.

### Group 8: parliamentary government

Runs after election resolution:

- **Government formation**: After a Commons/Bundestag/Shūgiin election, the winning party or coalition forms a government if they have the required majority. PM/Chancellor appointed.
- **No-confidence votes**: Active no-confidence votes tallied; if successful, government falls.
- **Confidence votes**: Active confidence votes tallied; if failed, government falls.
- **PM vacancy watcher**: If a PM seat has been vacant for 96 turns without a replacement, a snap election is automatically triggered.

### Group 9: election coverage

Ensures no seat sits vacant:

- **Perpetual elections**: For any office with no active or upcoming election, a new cycle is spawned, sized from the current census apportionment.
- **Country-specific election coverage**: Per-country election seeding (UK by-elections / Regional Council, JP Sangiin half-elections / governors, DE Bundestag + Landtag staggered cycles).
- **Leadership elections**: Expired leadership election cycles resolved.
- **Stale candidate cleanup**: Candidacies in elections that have expired without resolution are cleaned up; inactive candidates are withdrawn.
- **International organizations**: pending resolutions, admissions and leadership ballots resolve against the roll; the autonomous foreign-policy planner records one decision per country and cycle.
- **Alignment and settlement**: bloc shares drift, spheres update, and settlement crises (the German Question) tick, attach to wars, or resolve.
- **Impeachment lifecycle**: open impeachment votes advance and resolve.
- **Presidential succession**: If the President's seat is vacant, the VP is promoted.

### Group 10: fiscal year (conditional)

Only runs on the fiscal year-end turn (turn 40 of each 48-turn year, corresponding to October):

- **Fiscal year processing**: Annual budgets finalized, deficits/surpluses posted, regional budget allocations calculated.

### Group 11: effects & metrics

All parallel:

- **Policy effects**: Active state policies apply their metric effects each turn.
- **Demographic effects**: State demographic composition shifts based on economic conditions and policy.
- **Policy reaction decay**: Player policy reactions decay toward zero.
- **Archetype approval decay**: Approval ratings for each demographic archetype decay toward natural baseline.
- **Metric decay**: State metrics decay toward baseline values when no policies are active.
- **Unowned sector growth**: Sectors not owned by any corporation grow autonomously.
- **Regional budgets**: Regional spending affects state metrics (US, JP, DE each processed separately).
- **Crisis turn**: Active world crises apply their effects and potentially resolve.
- **Naval and air operations**: standing missions resolve so sea control, air superiority and supply are current before any battle reads them.
- **Ministerial orders**: Active ministerial orders processed. This is also where the military turn runs: force effects, then **battles resolve** (offensives declared last turn), then generals accrue tenure, then reinforcement, then peace windows and lapsed offers. See [Conflicts & the Military System](/wiki/conflicts-overview).

### Group 12: national aggregation

Sequential (each depends on previous):

1. **Metric engine and demographic flows**: state metrics move; population migrates.
2. **Census and era crossing**: a decennial census reapportions House seats and redraws district maps; scheduled era content resolves against the calendar year the world shows.
3. **GDP growth and national metrics**: Country-level aggregates recomputed from state-level data (GDP-weighted for economic metrics, population-weighted otherwise).
4. **Trade growth mirror**: Trade growth mirrored from the federal budget system to the central bank system (Forex prerequisite).
5. **Inflation recalculation**: Per-turn inflation recalculated using updated national metrics.
6. **Command economy**: plan fulfilment, directed credit, shortage and the marketization dial for planned economies.
7. **Forex turn**: Exchange rates updated (when Forex is enabled). Reads inflation differentials and trade volumes; fills limit orders.
8. **Central bank chair turn, FOMC meetings and nominations**: Chair scrutiny and bonuses updated; the Fed's rate meetings open and resolve at their deadline; pending Fed nominations resolve on the Senate's votes.
9. **Central bank chair selection**: Open chair vacancies outside the US filled if conditions are met.
10. **Referendum lifecycle and independence desire**: UK devolved referendums advance.

### Group 13: history

All parallel, all read-only:

- **Metric history snapshot**: State and national metric values recorded for history charts.
- **Approval snapshots**: Country-level approval history recorded.
- **Interest rate snapshots**: Central bank rate history recorded.
- **Party history snapshot**: Party seat counts and standings recorded.
- **Game health snapshot**: Turn duration, warning count, phase results recorded for admin monitoring.
- **Suspicious activity detection**: Financial pattern anomalies flagged for admin review.

### Group 14: persistence

This group is **not wrapped in the error-isolation pattern**. A failure here is fatal to the turn:

- **Turn counter update**: The turn number increments, the last-processed timestamp updates, and the turn-processing lock releases.
- **Turn log**: The full phase result log is saved (auto-deleted after 24 hours).
- **Live update**: A turn-complete event is broadcast to all connected clients so their screens refresh.

---

## The error isolation pattern

Every phase (except Group 14 persistence) runs inside an error-isolation wrapper. If a phase throws, the error is:

1. Logged to the console
2. Sent to Sentry
3. Recorded as a warning in the turn log

The turn does **not** halt. Subsequent phases continue processing. This means a broken bill lifecycle phase does not prevent elections from resolving. The admin panel shows warnings from the last turn.

---

## Fast mode

Fast mode runs turns every 30 minutes instead of every hour (i.e., 1 turn = 30 real minutes instead of 60). All timing calculations (election durations, bill deadlines) remain in hours, so everything simply completes in half the real-world time.

## Stuck turns

Every phase has a hard four-minute ceiling; a phase that runs past it fails and takes the turn with it. A turn whose process dies partway leaves the processing lock held, and a recovery sweep every five minutes repossesses an abandoned turn so the wait is bounded. That sweep is strictly a recovery path: it never starts a turn that is merely due, so the clock still advances only on the normal ticks. World News posts are de-duplicated so a turn that is taken over while still finishing reports each event once.

---

## Related

- [Reference: Formulas](/wiki/reference-formulas): All game math in one place.
- [Election Mechanics](/wiki/election-mechanics): Election phase structure.
- [Snap Elections](/wiki/snap-elections): Parliamentary dissolution triggers.
- [The Game Loop](/wiki/the-game-loop): Player-facing explanation of the turn cycle.
`;
