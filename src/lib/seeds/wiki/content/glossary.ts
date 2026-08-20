export const glossaryContent = `# Glossary

Alphabetical definitions of terms used throughout A House Divided and its wiki.

---

**Action**: The primary resource consumed by player activities. Base 4 per turn, refreshed every real hour. Unused actions are lost when the turn processes. Office bonuses add to this pool.

**Action bonus**: Additional actions per turn granted by holding a specific office. Example: Senator gets +2/turn; President gets +4/turn.

**Alignment**: The component of primary and general election scores based on how close a candidate's policy position (econ + social) is to the party platform or the voter demographic. Also used in canvassing: the closer your ideology to a demographic group's ideology, the more effective your canvassing.

**AMS (Additional Member System)**: The mixed-member proportional representation system used in Germany's Bundestag elections. Seat allocation is partially proportional to party vote share, making third parties more viable than in pure FPTP.

**Approval rating**: A country-level aggregate of public opinion. In the US, derived from the President's favorability. In UK/JP/DE, derived from the PM/Chancellor's favorability. Tracked historically and visible on country pages.

**Cell**: One combination of census buckets (for example white, mature, no college, middle income) used in vote appeal and turnout calculations. Each cell has an economic/social position averaged from its buckets and a turnout rate blended from theirs. Cells are what the vote engine counts.

**Cabinet**: The executive advisory body appointed by the President (US), Prime Minister (UK, JP), or Chancellor (DE). Cabinet positions grant certain powers (the Secretary of the Treasury can authorize FX Reserve Transfers). US Cabinet members are confirmed by the Senate; parliamentary cabinets are appointed directly after government formation.

**Campaign**: A Campaign document created when you declare candidacy in an election. The campaign tracks your fundraising level, ground game, media spending, opposition research, and campaign actions. Campaign passive effects run each turn; the 2× season multiplier applies in the final 4 turns.

**Campaign season**: The final 4 turns (real hours) before an election ends. All campaign passive effects double during campaign season. This is the most valuable window for canvassing and active campaigning.

**Candidacy**: Your formal entry into an election's primary. Candidacies are tied to a party, an election, and an office. You can only hold one active candidacy at a time.

**Canvassing**: An action (₳100, 1 action) that boosts voter turnout for a specific demographic group in your active campaign state (home state for most characters; presidential candidates use their travel/primary state). Effect is subject to alignment multiplier, diminishing returns, and a ±20 cap. Doubles in effectiveness during campaign season.

**Central bank**: Each country has a central bank (US: Federal Reserve; UK: Bank of England; DE: European Central Bank; JP: Bank of Japan) that sets interest rates, affecting bond yields, corporate borrowing, and currency strength. The bank's chair is a high-bonus office.

**Chancellor**: The head of government in Germany. Equivalent to Prime Minister in the parliamentary sense. Elected by the Bundestag majority.

**Coalition**: A formal agreement between two or more parties to collectively hold a parliamentary majority. Coalitions allow smaller parties to share power. Coalitions can be dissolved by member vote.

**Commons**: The House of Commons, the elected lower chamber of the UK Parliament. 650 seats, FPTP. Whoever commands a Commons majority (326+ seats) forms the government.

**Country**: The nation your character belongs to (US, UK, DE, JP, and others). It determines which country's elections, legislature, and parties they participate in. Set at character creation, but can be changed later through relocation, which resets your national influence and party affiliation in the new country.

**Cycle**: One complete election from spawn to resolution. When a general election resolves, a new cycle begins immediately (next election spawns).

**Demographic effect**: A turn-processing phase that shifts state-level demographic composition based on economic conditions and active policies.

**Diminishing returns**: A mechanic that reduces the effectiveness of repeated actions on the same target. Canvassing a turnout modifier already at +18 returns ~10% of base effect. Applies to both canvassing and influence building.

**Dissolution**: Ending a parliamentary term early to call snap elections (UK Commons, JP Shūgiin, DE Bundestag). Triggers a compressed election cycle.

**Econ axis**: The economic dimension of the two-axis ideology grid (−100 to +100). Negative = left (redistributive, regulated); positive = right (market, low tax). Alongside the social axis, determines party alignment scoring.

**Election timer**: The countdown tracking when a primary or general election ends. Processing group 7 advances timers each turn; elections marked "completed" by the timer phase are resolved in the same turn.

**Endorsement**: A formal expression of support from a player or NPP for your candidacy. NPP endorsements grant campaign actions. Player endorsements count as campaign actions for presidential races only.

**Favorability**: A 0 to 100 stat representing public approval of your character. Used in primary scoring (worth up to 35 pts state, 10 pts presidential), general vote appeal (as an approval scalar), and national/PM approval ratings.

**FPTP (First Past the Post)**: The winner-take-all election system used in the US, UK, and JP. The candidate with the most votes wins the seat. Creates spoiler effects: third parties bleed votes from the major party ideologically closest to them.

**Fiscal year**: The game-year equivalent of October (turn 36 of 48). Budgets are finalized, deficits/surpluses posted, and regional grant allocations calculated once per game year.

**General election**: The second phase of an election cycle, after primaries. Candidates from different parties compete; votes accumulate each turn using the Total Appeal Pipeline. The final 4 turns carry 25% of total votes.

**GOTV (Get Out The Vote)**: The party action that boosts demographic turnout modifiers. Controlled by party chair GOTV budget allocation. Stacks additively with player canvassing, subject to the ±20 cap.

**Ground game**: A campaign branch tree (starter node plus Field Offices, Get-Out-The-Vote, and Volunteer Corps branches) that boosts turnout in a race's competitive areas. Costs ongoing maintenance; unaffordable branches auto-downgrade.

**Home state / region**: The sub-national unit (US state, UK nation, DE Land, JP prefecture) where your character is based. Determines which elections you can enter, where you can canvass, and where your in-state party org applies.

**Ideology grid**: The two-axis system (econ × social) used to position characters, parties, NPPs, and voter groups. Alignment scoring uses Manhattan distance on this grid.

**Infamy**: A permanent accumulated stat increased by attacks, whip defiance, and certain actions. High infamy reduces NPP endorsement success rates and affects some approval metrics. Does not reset.

**Influence**: Short for Political Influence (state level) or National Political Influence (national level). Used in primary score and general vote calculations. Built via Campaign actions; decays 0.75%/turn.

**Kokkai**: The Japanese national legislature, composed of the Shūgiin (lower) and Sangiin (upper) houses.

**Layer 1**: The census dimensions a region carries and the buckets inside them. In the US: race, age, education, wealth (plus ideology, which canvassing can target). They are combined into the cells used for vote appeal and turnout.

**Majority**: The seat count required to control a legislative chamber or form a government. US House: 218; UK Commons: 326; DE Bundestag: 316; JP Shūgiin: 233.

**Manhattan distance**: The sum of absolute differences on the econ axis and social axis. Used to calculate ideological alignment. Distance 0 = perfect match; each point of distance costs 2 alignment points in the primary formula.

**Media Spending**: A campaign branch tree (starter node plus Broadcast, Television, and Rapid Response branches) that passively boosts the candidate's favorability each turn. Doubles during campaign season.

**National metrics**: Country-level aggregated statistics (GDP, inflation, healthcare index, etc.) derived from state-level data each turn. Visible on country overview pages.

**NPI (National Political Influence)**: A national-level reputation metric, distinct from state PI. Grows from high offices, national legislation, and long-term activity. The primary influence stat for presidential primaries and national vote calculations.

**NPP (Non-Player Politician)**: An autonomous politician generated by the game to fill empty seats and primary slots. NPPs enter elections, vote on bills, and make decisions based on ideology alignment and whip directives. They receive a 0.5× primary score penalty when a player is in the same primary.

**Office**: An elected or appointed position that grants action bonuses, income, and legislative/executive access. See [Reference: Offices](/wiki/reference-offices) for all offices and their stats.

**Opposition research**: A campaign branch tree (starter node plus Dossier, Scandal Leak, and Counter-Intel branches) that passively debuffs a target opponent's favorability each turn. Retargetable.

**Party org**: Party organization: a 0 to 100 metric per state representing a party's ground-level infrastructure. Affects general election vote scalars (0.5× to 1.0×) and presidential primary scores.

**Phase**: One step in the hourly turn processing sequence. Turn processing runs through roughly a dozen top-level adapters that together call over 100 phase steps each turn. See [Reference: Turn Order](/wiki/reference-turn-order) for the complete list.

**Political Influence (PI)**: State-level reputation built via Campaign actions. Used in state primary scoring (up to 25 pts) and general vote reach calculations. Decays 0.75% per turn.

**Primary**: The intra-party competition phase of an election. Candidates from the same party compete by primary score; the highest score per party advances to the general. Closed when the primary window ends.

**Primary score**: The calculated total (0 to 100) used to determine which candidate advances from a primary. Comprises alignment + favorability + influence. NPPs receive a 0.5× penalty when a player is competing.

**Prime Minister**: The head of government in the UK and Japan. Emerges from a parliamentary majority; no direct election. The PM's favorability drives national approval ratings.

**RCV (Ranked Choice Voting)**: An alternative to FPTP used in some US states (set by state legislation). Third parties compete on equal footing without the spoiler effect.

**Sangiin**: Japan's House of Councillors (upper house). 248 seats, staggered 6-year terms. Cannot be dissolved. Revises legislation but cannot override the Shūgiin on confidence matters.

**Shūgiin**: Japan's House of Representatives (lower house). 465 seats, FPTP. The confidence-granting chamber: PM survival requires Shūgiin majority support. Can be dissolved for snap elections.

**Snap election**: An early election called before the end of a parliamentary term. Available in the UK (PM-initiated), JP (PM-initiated via Shūgiin dissolution), and DE (Chancellor-initiated via Bundestag dissolution). Compresses the campaign cycle dramatically. See [Snap Elections](/wiki/snap-elections).

**Social axis**: The social dimension of the two-axis ideology grid. Negative = progressive (individual rights, social liberalism); positive = conservative (traditional values, social order).

**Spoiler effect**: In FPTP elections, a third-party candidate draws votes from the ideologically closest major party, potentially handing the race to the opposition. Modeled by transferring 10% of a third party's group-level votes from the nearest major-party candidate.

**State metrics**: Per-state statistics (healthcare index, economic index, education index, environment index, etc.) that shift based on active policies, demographic effects, and spending. Used in approval calculations and vote appeal.

**Term**: The fixed length of time an elected official holds an office before the next election cycle opens. US House: 2 years (96 turns); US Senate: 6 years (288 turns); Governor: 4 years (192 turns).

**Total Appeal Pipeline**: The per-turn formula used to calculate how many votes each candidate receives from each demographic group. Components: reach, appeal, approval scalar, party org scalar. Used identically for vote accumulation and polling projections.

**Turn**: One unit of game time = one game week = one real hour. The hourly cron processes all game phases during a turn.

**Turn log**: A record of everything that happened during a turn: which elections resolved, which bills advanced, which phases ran. Stored for 24 hours. Visible to admins; key events visible to players via notifications.

**Whip directive**: An instruction from party leadership to NPP legislators on how to vote on a specific bill. NPPs in the party generally follow the whip. Players can defy the whip at an infamy cost.

**Withdrawal**: Cancelling an active candidacy. Once withdrawn, you cannot re-enter the same election. Your votes are permanently removed from the tally. Candidates whose party changes mid-election are auto-withdrawn.

---

## Related

- [Reference: Formulas](/wiki/reference-formulas): All formula details.
- [Reference: Turn Order](/wiki/reference-turn-order): Full turn processing sequence.
- [Reference: Offices](/wiki/reference-offices): All offices and their stats.
- [FAQ](/wiki/faq): Answers to common questions.
`;
