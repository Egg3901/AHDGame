export const electionMechanicsContent = `# Election Mechanics

Elections in A House Divided run perpetually. Every office has continuous cycles: a cycle resolves, the next one spawns immediately, seats never sit vacant. This page is the top-level reference for **how** elections work: phases, timing, scoring, vote math. Deep dives for primaries, generals, and country-specific rules get their own pages.

## The two phases

Every election has two phases:

1. **Primary phase**: intra-party competition. Candidates from the same party compete for one nomination slot. **Down-ballot races** (House, Senate, Governor, State Senate and their equivalents abroad) count **real primary ballots**: over the closing stretch of the primary, each party's registered voters release a slice of ballots every turn, split between that party's candidates by their standing that turn, and the nominee is whoever the cumulative count says. The standing is the **primary score** below, so the score still decides who is ahead each turn, but a late surge moves the result less than a sustained lead. **Presidential** primaries instead run staggered state voting that hands out **pledged delegates**, and the delegate leader is nominated, at a [convention](/wiki/nominating-convention) if no one holds a majority.
2. **General phase**: inter-party competition. Nominees from different parties compete. **Votes accumulate turn by turn**; the final 4 turns land 30% of the pool. Only **registered** voters cast general ballots, and a race can never certify more ballots than it has voters.

When the general resolves, winners take office and the next cycle spawns.

## Duration by race type (US)

All durations are in **real hours** = game weeks.

|| Office | Total | Primary | General |
| --- | --- | --- | --- |
| House | 96h (2 game years) | 48h | 48h |
| Senate | 288h (6 game years) | 240h | 48h |
| Governor | 192h (4 game years) | 144h | 48h |
| State Senate | 192h (4 game years) | 144h | 48h |
| President | 192h (4 game years) | 144h | 48h |

Senate seats are split into three classes per state, staggered roughly a third of the 288h cycle apart, so one-third of the Senate is up for election at any given time.

UK, DE, and JP use different cycle lengths; see each country hub for specifics.

## The primary score (state races)

The score is each candidate's **standing** within their party's primary. It sets how each turn's slice of primary ballots is split between them, and it is the tiebreak path where a party has no registered voters to cast any (a party with no registration data on file resolves on score alone, the way every primary once did). Primary scores go up to 100 points across four components, then a final infamy penalty applies:

| Bucket | Range | Formula |
| --- | --- | --- |
| Alignment: state | 0-25 | \`max(0, 25 - (|econDiff_state| + |socialDiff_state|) * 1.25)\` vs. state cached lean |
| Alignment: party | 0-15 | \`max(0, 15 - (|econDiff_party| + |socialDiff_party|) * 0.75)\` vs. party position |
| Favorability | 0-35 | \`(favorability / 100) * 35\` |
| Influence | 0-25 | \`sqrt(min(100, PI) / 100) * 25\` |

Final score = raw * \`(1 - 0.05 * infamy/100)\`, a 5% reduction at infamy=100.

Of the 40 alignment points, 25 measure how closely you match your state's politics and 15 measure how closely you match your party platform. State match is the bigger factor. If a state has no cached lean, alignment falls back to a single 40-point check against the party (preserving the pre-rework formula).

**NPP candidates get a 50% primary-score multiplier** when at least one player is in the same party's primary: a 50-point NPP lands at 25, which makes competent player candidates heavy favorites. NPPs aren't subject to the infamy penalty.

## The primary score (presidential)

A presidential nomination is decided by the **pledged delegates** won across the staggered state waves (see below), settled at a [nominating convention](/wiki/nominating-convention) when no candidate holds a majority. The score below is the national ranking the game falls back to when there is no delegate or vote data to read (for example an admin-forced resolution that skips the waves). It weights party platform and national reach instead of state position:

| Bucket | Range | Formula |
| --- | --- | --- |
| Alignment | 0-40 | \`max(0, 40 - (|econDiff_party| + |socialDiff_party|) * 2.0)\` vs. party position |
| Party Influence | 0-20 | Normalized on the candidate's own accumulated party influence (uncapped above the reference scale) |
| National Reach | 0-15 | Diminishing-returns curve on national political influence, scaled to 15 points |
| Favorability | 0-25 | \`(favorability / 100) * 25\` |

Same infamy penalty applies on the final score. Alignment stays dominant, but Favorability was repriced from 10 to 25 points so the primary selects for roughly what the general election rewards, and parties stop nominating candidates the electorate has already rejected.

**Presidential primary stagger waves** use a delegate accumulator. States vote in six waves modeled on the 2020 calendar (Iowa, then New Hampshire, then Nevada and South Carolina, then a 14-state Super Tuesday, then mid-March, then everyone remaining), each wave allocating pledged delegates. Older and unstamped races (including the 1960 race) run all six waves **compressed** into the final 6 turns; reworked races (1964 onward) run them **stretched** across the primary so results land with a reaction gap. A primary keeps whichever cadence it opened on. NPPs in stagger waves receive an **extra 0.6 multiplier** on top of the usual handicaps when a player is in the same party. See [Primaries](/wiki/primaries) and [the convention](/wiki/nominating-convention) for the full flow.

## Vote accumulation (general)

During the general phase, votes accumulate each turn via the **Total Appeal Pipeline** (also used by polling and NPP dropout calculations).

### Per-turn weighting

A three-tier closing surge, not a flat split. The same curve paces the primary ballot count over its closing window:

- **Early band:** 50% of the pool spread over every turn before the ramp band.
- **Ramp band:** the 8 turns before election day get 20% of the pool.
- **Final band:** the last 4 turns get 30% of the pool.

In other words, the last 4 turns are worth **~30% of the entire election**. If you're within a few points going into the last day, every campaign and ad action in those 4 turns compounds into the heaviest-weighted snapshots. Very short races (4 turns or fewer) spread the pool evenly instead.

### The total appeal pipeline

For each demographic group, for each candidate, per turn:

1. **Reach**: a sqrt curve on political influence, capped at 1.0 once influence reaches 100. State and presidential general elections both use this curve. Presidential primaries use a gentler diminishing-returns curve instead, leaving more room for Support, Favorability, and Org to compete.
2. **Appeal (per group)**: \`25 * ((50 - |econDiff|*5 - |socialDiff|*5) / 50)^1.5 + APPEAL_POSITION_FLOOR(0.5) + DIRECTION_BONUS(tribal, up to +10) + reach * 12.5\`. Power-curve position scoring (exponent 1.5, softened from the legacy squared curve) with a floor, directional bonus, and influence multiplier. Position alone maxes at 25.5, directional bonus at 10 (5 per axis, both axes aligned), influence at 12.5 -- theoretical ceiling around 48, though the position+direction terms are the dominant share in practice.
3. **Approval scalar**: \`(effectiveFavorability / 100) ^ 0.8\`, where \`effectiveFavorability = favorability + groupApproval * 0.5\` (clamped 0-100). 0% effective favorability = 0 votes. The power curve softens differences in the middle while preserving both endpoints.
4. **Party org scalar**: a normalized share model, \`(partyOrg / totalStateOrg)^0.2\`. Diminishing returns: a 3:1 org lead yields only ~1.25:1 weight. Ranges from 0 (no presence in a populated state) to 1.0 (monopoly), or a neutral 1.0 everywhere when the state has no org data at all. Primaries use a uniform neutral 1x instead (intra-party org cancels). Presidential races use the same normalized-share curve, no separate crowded-field damping.
5. **Infamy scalar**: \`1 - 0.05 * (infamy/100)\`. Player characters with high infamy lose up to 5% of their per-group weight. NPPs aren't affected.
6. **Turn pool scaled by party strength modifier:**
   - **State races:** \`(1 + (stateGovernmentApproval/100 - 0.5) * 0.2) * officeStrength\`. At 50% approval the modifier is 1.0x; at 100% it is 1.1x; at 0% it is 0.9x.
   - **Presidential races:** \`(1 + (stateGovernmentApproval/100 - 0.5) * 0.5) * officeStrength\`. At 50% approval the modifier is 1.0x; at 100% it is 1.25x; at 0% it is 0.75x.
7. **Group-level allocation**: Each group contributes to the turn pool proportional to its size. Within each group, candidates split that contribution by relative \`(appeal * reach * approval * partyOrg * nppPenalty * infamyMult)\`.
8. **Votes summed** across all groups. That's your turn total.

Office strength multipliers:
- Governor: 1.0
- State Senate: 0.85
- House: 0.9
- Senate: 0.8
- President: 1.0

Because the approval modifier is a flat +/-10% around the base for state races and +/-25% for presidential races, presidential elections feel state approval much more strongly.

### NPP general weight penalty

In general elections where at least one player is in the race, NPPs receive an **0.8x weight penalty** on their per-group vote weight. This is separate from the 0.5x primary-score penalty and applies only during the general phase. It ensures NPPs remain competitive but lose their structural advantage over active players.

### FPTP vs RCV: the spoiler effect

Most states use **First Past the Post** (FPTP). A few run **Ranked Choice Voting** (RCV). This is a state-level legislative choice.

In **FPTP** states, after the per-turn group allocation:

- For each third-party candidate, \`4% * (their group-level votes)\` is drawn from the **ideologically nearest major-party candidate** and transferred to the third party.
- In **presidential** races, the rate is halved to **2%**.
- "Nearest" = Manhattan distance on the econ/social grid.
- Major parties are determined per region: Democrat/Republican in the US, Labour/Conservative in England, SNP/Labour in Scotland, etc.
- In **presidential** races only, the transfer is additionally **organization-aware**: a third party with stronger state org than the nearest major party amplifies the bleed (factor 0.25x-2x). State-level races (House, Senate, Governor, State Senate) do not apply this org-aware adjustment.

This models real-world spoiler dynamics: a Green candidate bleeds Democratic votes, potentially handing the seat to the Republican.

In **RCV** states, no spoiler adjustment applies. Third parties compete on equal footing. Switching a state from FPTP to RCV requires legislation.

## Reg, support, and swing-flow mechanics

The general-election pipeline includes three swing-flow factors that modulate how votes move between parties:

1. **Registration resistance multiplier**: \`regResistanceMultiplier = 1 + 0.3 x (Reg / 100)\`. Range \`1.0x-1.3x\`. Higher own-registration makes the party harder to peel away through persuasion. Independents and parties without a registration entry get neutral 1.0x.
2. **Support mood multiplier**: \`supportMoodMultiplier = 0.6 + 0.8 x (support / 100)\`. Range \`0.6x-1.4x\` with neutral 1.0x at support=50. Captures short-term candidate mood / momentum (debate performance, scandals, endorsements). New candidates without a stored support value default to 1.0x.
3. **Transferable share**: The fraction of a party's vote pool that is open to persuasion in a given turn. Base \`transferableShare\` is scaled by \`regResistanceMultiplier\` (higher Reg = smaller transferable pool) and candidate \`persuasionResistance\` (some candidates have innate resistance to being peeled away from their base party).

These factors mean a candidate with high Support, low opponent Registration, and low persuasion resistance can swing larger vote shares per turn than one facing entrenched opposition in a high-Reg state.

Two more swing-flow drivers matter for down-ballot strategy:

4. **Coattails**: a sitting executive's approval swings a nominal-share multiplier for their own party in every eligible down-ballot general, governor coattails at state scope, presidential coattails at national scope (US only for now). A popular incumbent lifts their whole party's ticket; an unpopular one drags it.
5. **Party-tenure fatigue**: a "time for a change" effect on a party that has held the executive office for multiple consecutive terms. It is priced in the National Mood channel below, as a multiplier on the economic penalty side, not as a drag inside this driver.

Both apply after the base appeal pipeline and are separate from the reg/support/transferable-share factors above.

## National Mood (economic referendum)

Presidential races carry one more channel: the economy is scored as a referendum on the party that holds the office. The presidential race page shows it as the **National Mood** card, so you can read the size and direction of the push before election day instead of inferring it from the result.

What feeds it:

- **Unemployment** above the natural rate of 6%: 0.6 share points per point, capped at 4.
- **Poverty** above the 20% baseline: 0.15 share points per point, capped at 3.
- **Inflation** outside the 1% to 4% band, in either direction: 0.4 share points per point, capped at 3.
- **Real median income trend**, flat being neutral: 0.3 share points per point either way, capped at 1.5.

Each component is signed. A good economy pays the incumbent party a bonus, capped at 4 points in total; a bad one charges a penalty. The signed total is then clamped to **+/-8 points** of national vote share, so the economy can decide a close race but never hands one side an automatic win.

**Credit for response.** Metrics move slowly and elections do not wait for them, so voters partially forgive a government that is visibly acting. National bills enacted in the last 24 turns that push a suffering component the right way (unemployment or poverty down, real incomes up) cut the raw penalty by up to **40%**, scored per component: five jobs bills do nothing about an inflation penalty. Three rules keep it honest. A bill must have carried a real budget cost. The first bill on a component earns full weight and later ones earn half, then a quarter, and so on. And if the component's metric has kept getting worse over the eight turns since the response landed, that component's credit is cancelled outright. Inflation cannot earn credit at all, because no law in the game declares a direct effect on it.

**Term fatigue scales the penalty side only.** A party seeking a 3rd consecutive term wears a bad economy at 1.25x, a 4th or later at 1.5x. Fatigue applies to what is left of the penalty after credit for response, so acting on a downturn is worth more the longer your party has held the office. The bonus side is never scaled, so a long-tenured party gets no extra credit for good numbers. The card shows this line only when it applies.

This is now the only place party-tenure fatigue is priced. The older "time for a change" drag inside the incumbency persuasion driver has been removed; it only moved the thin persuadable slice of the vote and was too weak to feel.

**Tenure also erodes the candidate's own standing, by a smaller amount.** Party-tenure fatigue above prices how a party wears a bad economy. Holding office separately builds up a personal advantage, because influence and favorability grow every turn you campaign and never fall back on their own, so a sitting member carries the same edge into every election forever. To stop that compounding without erasing it, the candidate's influence and favorability are scaled down by 3% for each consecutive term beyond the first, stopping at 15%. Someone who has held a seat for decades still runs on 85% of their standing, and a first-term holder, an open seat and a new nominee all pay nothing.

Which tenure counts depends on the office. For Senate seats and for each returning nominee in a House delegation it is that person's own unbroken run in the seat. For the presidency it is the **party's** run in the office, so a party seeking a fourth straight term carries the erosion even if it is running someone new.

The shift is applied inside the normal vote accumulation, so it is already in the totals the card and tally show. It is not added twice.

Because the inputs are live national metrics, this channel is a lever, not weather. Legislation and budget choices that pull unemployment, poverty, or inflation back toward their anchors shrink the penalty for whoever holds the office next election. Governing badly is a campaign cost.

## Multi-seat races

House and State Senate (US), Bundestag constituency seats, UK Commons regions, and JP Shugiin use proportional allocation:

- **Largest-remainder method** distributes seats proportional to vote share.
- **Minimum threshold:** 20% of votes for House and Commons; 10% for State Senate and Regional Council (larger districts with more parties splitting the vote).
- **2-seat special case (House only):** winner takes both unless the runner-up reaches the threshold.
- **Seats estimate:** updated each turn as each candidate's live vote share times the number of seats.

## Candidacy rules

- **One race at a time.** Active candidacies block new declarations (cancel first, then re-enter).
- **Home state / region only.** US home state, UK home region, DE home Land, JP home prefecture, except President, which is national.
- **Party required for primaries.** Independents run in the "independent" party primary (same rules as any other party). No general-phase bypass.
- **Country restriction.** Your character's home country must match the election's country; cross-country entry returns 403.
- **Primary deadline.** Declarations close when the primary window ends. Miss the window and you wait a full cycle.

## Withdrawal

You can withdraw any time before the election resolves:

- Candidate status -> \`withdrawn\`, \`withdrawnAt\` timestamped.
- Your votes are **permanently removed** from the tally (not redistributed).
- Your campaign document is deleted.
- You **cannot re-enter** the same election.

Withdrawal during a general you're losing is sometimes strategic: it frees actions for a better race next cycle. During a primary it's almost always wrong unless you're pivoting to a different office.

## Suspend & endorse (presidential general)

During the **general election only**, a presidential nominee may **suspend** their own campaign from the Campaign Manager page and **endorse** another active nominee:

- You **stay on the ballot**: this is not a withdrawal.
- Campaign operations stop: turn income, upgrades, rallies, travel, canvassing, contributions, and queued Support drips halt.
- **One-time campaign-strength transfer** at the moment of endorsement. A share of your campaign strength is debited from you and credited to your endorsed nominee, scaled by how ideologically and coalitionally aligned the two of you are: a well-aligned successor inherits about a quarter, a poorly aligned one much less. (Races that opened on the older ruleset still transfer a flat quarter.) This is a single transfer; no per-turn campaign-strength transfers occur after this.
- **Org boost:** **25% of your per-state character org investment** (the primary-cycle organization you built as a candidate, not the shared party-wide campaign presence score) is debited from you and added to your endorsed nominee's effective org for vote distribution in each state, for as long as you stay suspended.
- Your **existing vote tally is preserved**: votes already earned across every state stay counted. You remain on the ballot but accumulate **no further votes** in any subsequent turn.
- Suspended nominees forfeit all passive bonuses (swing-state ground game, VP home-state effect, campaign strength multiplier).
- **Irreversible** for the rest of the general. Nominee-only (not campaign manager).
- If your endorsed candidate **withdraws**, transfers are already complete and you remain frozen on the ballot. No further action needed.

## Perpetual continuity

No seat sits vacant. Mechanics:

- **House:** Next cycle spawned immediately on resolution.
- **Senate / Governor / State Senate:** Perpetual check each turn; replacement spawned for any slot with no active/upcoming race.
- **Governor bootstrap:** If no state has ever completed a governor race, one is spawned per state so cycle 1 exists.
- **President:** Spawned via the canonical LARP schedule when no active/upcoming president race exists; the cycle window plus a 24h primary / 24h general floor keep spawns aligned to real-world presidential election years.
- **New elections** inherit duration from the most recently completed equivalent race. A House race is sized from the current census apportionment, so a state reapportioned mid-game contests the right number of seats, and a race already on the ballot when a census fires is resized in place.

## Presidential election specifics

- **National race.** Any home state can run.
- **Campaign Presence (per-candidate, per-state):** Separate from party-wide state org. Build it on the Presidential Election page (the Campaign Presence map) or at Political Operations. Each +1 level costs 3 **campaign** actions plus an **escalating** cash price from the **campaign treasury** (about $250K for the first level, roughly a third more each level after), at most one level per state per turn. You need an active campaign to build it. There is **no level cap**, but the bonus curve flattens as the price compounds, so level 10 already delivers about three quarters of the maximum and the levels above it buy steadily less. Fully invested, a state approaches **+25% primary vote weight** and **+15% general vote weight** there. Levels drop to 25% after the presidential general resolves, so investment carries across cycles. This is the ground-game loop for a presidential run; party org is a different lever the chair controls.
- **Electoral College**: winning outright takes a **majority of the college the election actually apportioned**, which depends on the era's census. The modern roster is 538 electors (270 to win); the 1950s college is 531 electors (266 to win). Every threshold below is derived the same way from the rosters on the ballot. ME and NE split by congressional district (\`UNIT_LEAN\` modifiers).
- **Independent penalty:** 0.3x vote share on the general path (70% reduction).
- **Running mate (VP):** After the primary, each nominee picks a VP. Cannot be the current President; cannot be the same person.
- **Presidential Travel:** Active candidates can travel to a US state during the general. Cost is **3-10 actions** based on the state's electoral-vote count (<=5 EV = 3 actions; <=10 EV = 5; <=20 EV = 7; >20 EV = 10). +1% Favorability per turn while in-state, one state at a time.
- **Governor Endorsement:** A sitting Governor who endorses a presidential candidate in their home state applies a **1.5% bonus** (\`GOVERNOR_ENDORSEMENT_STATE_BONUS = 1.015\`) to that candidate's vote total in the state.
- **No EV majority:** If no candidate reaches the majority (including an exact tie or a third party blocking a majority), a **contingent election** runs. The **House** elects the President from the top three EV finishers (one vote per state delegation; DC has EVs but no House vote; a majority of the delegations on the ballot is needed: 26 of 50 today, 25 of 48 in the 1950s). The **Senate** elects the Vice President from the top two running mates (a majority of the senators voting: 51 of 100 today, 49 of 96 in the 1950s). Representatives and senators vote primarily by party, then ideology proximity; tied state delegations abstain. Chamber composition is **snapshotted** when the contingent ballot first runs so same-turn House/Senate flips cannot change the ballot mid-resolution.
- **MVP ballot:** Contingent races resolve on a **single simulated House/Senate ballot** per cycle. If neither chamber reaches its threshold, a deterministic deadlock breaker seats a winner (multi-turn contingent ballots with an acting VP are planned for a later version).
- **Party-weighted positions:** In presidential general elections, candidate positions are blended toward their party platform with weight 1/3 (\`(partyPos + 3 * charPos) / 4\`). This keeps nominees aligned with their coalition while preserving individual identity: 75% candidate, 25% party.
- **Swing-state ground game:** In swing states (|lean| < 0.5), candidates with invested ground game receive **+3% votes per ground-game level** (legacy level-based path); the newer Campaign Ops tree path grants the starter + branch magnitude instead of the flat per-level rate.
- **VP home-state effect:** A nominee whose running mate hails from the current state receives **+3%** in that state. Stacks with ground game.
- **Campaign strength multiplier:** Player campaign contributions build campaign strength, which applies a multiplicative vote boost. Each contribution adds \`0.75 * NPI\` strength. The curve is \`1 + 1 * (1 - exp(-strength/50,000))\`, soft-capping at **+100%** (2x total votes) at very high strength. Each campaign turn also pulls the strict campaign-strength leader in an active race back toward that race's average by up to 175 strength.
- **State lean multiplier:** Each electoral unit applies a lean multiplier: \`1 + lean * epSign * leanStrength\` (leanStrength = 0.3 for ME/NE districts, 0.1 for full states), clamped to **[0.8, 1.2]**. State partisanship stays visible as a tiebreaker-scale effect (at most a 1.5:1 two-party swing) rather than dominating appeal, which already prices in the state's leans.

## Polls vs simulated votes

- **State races** (House, Senate, Gov, State Senate, Commons, Bundestag, Sangiin, Shugiin): player polls use the **same** group-level competitive allocation and FPTP spoiler rules as real vote accumulation. Poll numbers reflect the actual math.
- **Presidential:** simulated votes accumulate **per electoral unit** using a different model (party-weighted positions, steep party-org curve, state-lean, swing-state ground game, FPTP spoiler **not** applied). Player polls remain **home-state** projections only and should **not** be treated as Electoral College forecasts.

## Related

- [Primaries](/wiki/primaries): Declaration rules, NPP dynamics, primary-phase tactics.
- [General Elections](/wiki/general-elections): Vote accumulation, final-turn weighting, tie-breakers.
- [Campaign Strategy](/wiki/campaign-strategy): Tactical decision-making.
- [Primary vs General Tactics](/wiki/primary-general-tactics): How to pivot between phases.
- [Demographics & Targeting](/wiki/demographics-targeting): Appeal math and group composition.
- [Snap Elections](/wiki/snap-elections): Parliamentary dissolution in UK, JP, and DE.
- [Reference: Formulas](/wiki/reference-formulas): Every formula with derivations.
`;
