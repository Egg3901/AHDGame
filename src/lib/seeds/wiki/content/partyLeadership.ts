export const partyLeadershipContent = `# Party Leadership

Every party has two leadership layers: **national** (chair, vice chair, treasurer) and **state** (chair, vice chair, treasurer per state). Leadership roles unlock party actions, whip authority over NPPs, and control over the party treasury.

## Leadership roles

### National party

| Role | Powers |
| --- | --- |
| **Chair** | Form coalitions, issue national whip directives, recruit NPPs nationally |
| **Vice Chair** | Assist chair, issue national whip directives in chair's absence |
| **Treasurer** | Manage national treasury, set national tax rate |

### State party

| Role | Powers |
| --- | --- |
| **State Chair** | Issue state whip directives, set GOTV/suppression/org-building budgets |
| **State Vice Chair** | Same whip powers as state chair |
| **State Treasurer** | Set state tax rate, manage state treasury budget allocations |

## Leadership elections

State party leadership elections are run through the **state party election** system. Elections are held for the positions of chair, vice chair, and treasurer separately.

### Who votes

All party members in that state who are in good standing can vote. NPPs in the state do not vote in state party elections.

### When they happen

Leadership elections are triggered by:
- A seat becoming vacant (the current holder leaves the party, switches parties, or their term ends)
- An existing leader manually triggering a new election
- Turn processing detecting a vacant leadership seat

### Election duration

State party elections run for a set number of turns configured on the election. Players can declare candidacy and vote during the open window. Votes can be cast once per voter; the candidate with the most votes when the window closes wins.

### Score formula for state elections

There is no automatic scoring formula for state leadership elections: it is a direct member vote. Each eligible voter casts one vote for one candidate. Majority wins; ties are broken by earlier entry.

## What leaders can do

### Whip authority

State chair and vice chair can issue **whip directives** to NPPs in their state. Directives tell NPPs how to vote on specific bills or leadership elections. NPP compliance depends on their personality:

\`\`\`
complianceChance = (loyalty × 0.7) + ((1 − stubbornness) × 0.3)
\`\`\`

| Loyalty | Stubbornness | Compliance Chance |
| --- | --- | --- |
| 100 | 0 | 100% |
| 50 | 50 | 50% |
| 0 | 100 | 0% |

Whipping is free: no action cost. But each NPP can only be whipped **twice per target per chamber**, so choose your directives carefully.

### Budget control

Leadership sets how the state party's income is allocated across three spending buckets (set as percentage of incoming revenue):

- **GOTV budget**: increases voter turnout for your party's demographics
- **Suppression budget**: reduces turnout for targeted opposition demographics
- **Org building budget**: invests in party organization score growth

Only chair, vice chair, treasurer, or national chair can adjust these percentages.

### NPP influence

National chair and vice chair can spend party resources to influence NPPs in states where no player is active. State chairs and vice chairs can influence same-party NPPs in their state using party action pools and treasury.

## National committee proposals

The national committee can vote on formal proposals to change the party. All proposals run for **24 turns** and pass or fail by **60% of filled roles** (more than half the eligible voters must vote yes or no to resolve early; otherwise the proposal expires).

### Who can propose and vote

| Action | Eligibility |
| --- | --- |
| Submit any proposal | Any committee member |
| Submit a merge proposal | National chair only |
| Vote on proposals | Committee members **plus** the national chair, vice chair, and treasurer |

National leadership (chair, vice chair, treasurer) can vote even if they are not on the committee. The eligible voter count used for majority thresholds includes all of them.

### Proposal types

| Type | Effect |
| --- | --- |
| Rename | Changes the party name and abbreviation |
| Position shift | Moves the economic or social position by ±1 |
| Election method | Changes how national leadership elections are tallied |
| Election duration | Sets a custom duration for future national elections |
| Merge | Dissolves the party by merging it into a target party |

### Rename

Proposes a new party name and abbreviation. If the proposal passes, the party name and abbreviation update immediately.

### Position shift

Proposes to move the party's **economic** or **social** position by **±1** step. The axis and direction (left/right) are locked in at proposal time. Positions are clamped to the -5 to +5 range, so you cannot shift beyond the boundary.

### Election method

Proposes how national leadership elections (chair, vice chair, treasurer) should be decided. Three options:

| Method | Description |
| --- | --- |
| All members (default) | Every party member may vote; one vote each |
| Committee-only | Only committee members and national leadership may vote; one vote each |
| Party influence weighted | Every party member may vote; votes are weighted by each voter's political influence within the party |

If passed, the new method applies the next time a leadership election opens.

### Election duration

Proposes a custom duration for future national leadership elections. The minimum is **168 turns** (1 week) and the maximum is **420 turns** (2.5 weeks). The party's default before any proposal passes is the game's standard duration. If passed, the custom duration is saved on the party and used when new elections are created.

### Merge

The chair proposes to dissolve the party by merging it into a target party. The proposal triggers **simultaneous votes** in both committees: the proposing party's committee and the target party's committee. **Both must pass** (simple majority each) for the merge to proceed.

**What happens on a successful merge:**

| What | How |
| --- | --- |
| Characters | All transferred to target party; political influence halved on transfer |
| NPPs | All transferred to target party |
| National treasury | 100% transferred to target party |
| State party org | 50% of each state's organization score added to target's state org (a new record is created if the target had no presence in that state) |
| Proposing party | Marked **defunct**: not deleted, but removed from party listings and flagged with the turn it dissolved |

Defunct parties cannot be joined. Their wiki and party pages remain accessible but display a "dissolved" banner, pointing to the party they merged into.

### Voting

Votes are cast in the Committee Proposals section of the party page committee tab. Eligible voters (committee members plus national leadership) may vote yes or no. You can change your vote while the proposal is still open. Vote counts are visible to all eligible voters in real time.

A proposal is resolved **early** as soon as one outcome is mathematically certain (e.g., yes votes exceed N/2 before all eligible voters have voted). Merge proposals wait for both committees before resolving.

## Related

- [Party Membership](/wiki/party-membership): Who is eligible to vote in leadership elections.
- [Party Organization](/wiki/party-organization): What org building budget does.
- [Party Actions](/wiki/party-actions): What the action pool funds.
- [NPP Behavior](/wiki/npp-behavior): Full whip compliance mechanics.
- [Coalitions](/wiki/coalitions): Coalition chair mechanics and succession.
`;
