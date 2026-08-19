export const referenceTurnOrderContent = `# Reference: turn order

The game runs on an hourly cron. Every real-world hour is one game turn, which is one game week. Turn processing runs through roughly a dozen top-level adapters that together call over 100 phase steps, each hour. This page lists the major groups of phases, what runs in each, and why the ordering matters.

**1 turn = 1 game week = 1 real hour**
**48 turns = 1 game year**

---

## Turn sequence overview

| Group | Phases | Key constraint |
|---|---|---|
| 1. Resources | Action refresh, fund generation, corporation turn | Parallel-safe |
| 1a. Finance | Bond coupons, NPP funds, commodity prices, portfolio snapshots, savings interest, line of credit, financial suspect scan | After corporations (bonds need updated liquid capital) |
| 2. Demographics | Turnout decay, party GOTV, party org maintenance, reg drift decay, pressure decay, priority region decay, support decay, support accrual | Sequential |
| 3. Party elections | State/national/committee elections, party actions, empty party cleanup, coalition disband votes, charter expiry, NPP relationship maintenance, governor legislation queue | Parallel then cleanup |
| 4. NPP behavior | Election entry, bill voting, speaker voting | Uses shared NPP context |
| 5. Bills & cabinets | Bill lifecycle, state bills, cabinet nominations, governor AP regen, governor executive orders, governor address expiry, governor/executive endorsements | Parallel-safe |
| 6. Campaigns | Campaign turn, NPP action processing (every 4 turns), activity logging | Sequential |
| 7. Election resolution | Primary resolution → vote accumulation → campaign spend reset → timer advancement → snapshots → general resolution → clear resolved support → leadership vacate | **Strictly sequential: ordering is load-bearing** |
| 8. UK/parliamentary government | Government formation, no-confidence votes, confidence votes, PM vacancy watcher | After election resolution |
| 9. Election coverage | Perpetual elections, snap election checks, leadership elections, stale cleanup, auto-reelection entry, presidential succession, international organizations | Parallel-safe |
| 10. Fiscal year | October processing (turn 36 of 48) | Conditional |
| 11. Effects & metrics | Policy effects, demographic effects, approval decay, GDP growth, metric decay, subsidy budget, regional budgets, crisis turn, ministerial orders, top sectors recompute | Parallel-safe |
| 12. National aggregation | GDP growth, national metrics, trade growth mirror, inflation recalc, Forex updates, central bank chair turn/selection, independence desire drift | After state effects |
| 13. History | Metric snapshots, approval snapshots, interest rate snapshots, party history, portfolio/corp portfolio/stock exchange/investor ranking/wealth list snapshots, suspicious activity detection, game health snapshot | Parallel-safe |
| 14. Persistence | Increment turn counter, save turn log, send live update | Not wrapped in try/catch |

---

## Group details

### Group 1: resources

Runs at the start of every turn, in parallel:

- **Action refresh**: All player characters receive base 4 actions per turn (plus any office bonuses from game settings). NPP actions also refreshed.
- **Fund generation**: Player characters receive passive income from held offices (state taxes + national taxes). Party treasuries receive contributions.
- **Corporation turn**: Sectors generate revenue; corporations receive dividends and pay out income to character shareholders.
- **Party influence turn**: Bonus actions from party influence are merged with the refreshed pool (runs after action refresh, cap enforced).

### Group 1a: finance

Runs after corporations so bond coupon flows can read updated liquid capital:

- **Bond turn**: Sovereign and corporate bond coupons paid; matured bonds settled; defaults processed.
- **NPP fund generation**: NPPs receive passive income (if enabled).
- **Line of credit turn**: Interest accrues on outstanding credit; auto-pay from this turn's income.
- **Savings interest turn**: Interest credited on savings balances.
- **Commodity prices**: Commodity price indices updated.
- **Portfolio snapshots**: Character and corporation portfolio values snapshotted; stock exchange and wealth-list rankings updated.
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

- **NPP election entry**: NPPs evaluate open primaries and decide whether to enter (entry chance: 92% for empty races, 55% for occupied races, decayed by 0.6× per existing NPP, max 6 per race).
- **NPP bill voting**: NPPs vote on active bills based on ideology alignment and whip directives.
- **NPP speaker/leadership voting**: NPPs vote in leadership elections.

### Group 5: bills & cabinets

All parallel:

- **Bill lifecycle**: Bills advance through floor votes and executive signature. Bills that expire are marked failed.
- **Country-specific bill phases**: UK Parliament enactment, DE/JP specific bill phases.
- **State bill timers**: State-level bill deadlines advanced.
- **Cabinet nominations**: Presidential/PM cabinet nominations processed.

### Group 6: campaigns

- **Campaign turn**: Each active campaign receives income (based on fundraising level), generates campaign actions (based on endorsements), pays maintenance, and applies passive effects (media spending favorability, opposition research debuffs, travel presence bonuses). The final-4-turn 2× season multiplier applies here.
- **NPP action processing**: NPPs execute queued actions (runs every 4 turns only).
- **Activity logging**: Turn summaries are recorded for the activity feed.

### Group 7: election resolution (strictly sequential)

This is the most critical group. The phases must run in this exact order. Reordering produces incorrect election results:

1. **Candidate party sweep**: Candidates whose party no longer matches their candidacy are auto-withdrawn (party switches).
2. **Primary resolution**: Primaries that have reached their end time are scored. Highest-score candidate per party advances; others are marked withdrawn.
3. **Vote accumulation**: General elections accumulate votes for this turn. MUST run after primaries (eliminated candidates are excluded) and BEFORE timer advancement (so the final turn's votes are captured).
4. **Election timers**: Countdown clocks advance; elections that have reached their end time are marked "completed."
5. **Primary snapshots**: Cumulative primary-phase scores recorded for polling history.
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

- **Perpetual elections**: For any office with no active or upcoming election, a new cycle is spawned.
- **Country-specific election coverage**: Per-country election seeding (UK by-elections / Regional Council, JP Sangiin half-elections / governors, DE Bundestag + Landtag staggered cycles).
- **Leadership elections**: Expired leadership election cycles resolved.
- **Stale candidate cleanup**: Candidacies in elections that have expired without resolution are cleaned up.
- **Presidential succession**: If the President's seat is vacant, the VP is promoted.

### Group 10: fiscal year (conditional)

Only runs on the fiscal year-end turn (turn 36 of each 48-turn year, corresponding to October):

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
- **Ministerial orders**: Active ministerial orders processed.

### Group 12: national aggregation

Sequential (each depends on previous):

1. **GDP growth**: GDP updated from sector revenue changes. Runs after unowned sector growth.
2. **National metrics**: Country-level aggregates recomputed from state-level data (GDP-weighted for economic metrics, population-weighted otherwise).
3. **Trade growth mirror**: Trade growth mirrored from the federal budget system to the central bank system (Forex prerequisite).
4. **Inflation recalculation**: Per-turn inflation recalculated using updated national metrics.
5. **Forex turn**: Exchange rates updated (when Forex is enabled). Reads inflation differentials and trade volumes; fills limit orders.
6. **Central bank chair turn**: Chair infamy and bonuses updated.
7. **Central bank chair selection**: Open chair vacancies filled if conditions are met.

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

---

## Related

- [Reference: Formulas](/wiki/reference-formulas): All game math in one place.
- [Election Mechanics](/wiki/election-mechanics): Election phase structure.
- [Snap Elections](/wiki/snap-elections): Parliamentary dissolution triggers.
- [The Game Loop](/wiki/the-game-loop): Player-facing explanation of the turn cycle.
`;
