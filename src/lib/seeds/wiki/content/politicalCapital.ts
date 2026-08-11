export const politicalCapitalContent = `# Political Capital

Political Capital is the direct, player-to-NPP interaction system that lets you spend character actions and campaign funds to shift an individual non-player politician's relationship, favorability, and political influence. There is no feature flag: it is always available, and every action is **deterministic** (no randomness, no dice rolls).

## How it works

Each Political Capital action has four fixed attributes:

- **Action Cost**: the number of character actions it consumes
- **Fund Cost**: campaign funds spent (in ₳)
- **Min Relationship**: minimum current relationship required to attempt the action
- **Effect**: a human-readable summary of what the action does

Relationship deltas are recorded immediately. Every action is written to a ledger entry that captures the relationship before and after, the actions spent, and the funds spent, so the full history of an NPP relationship is auditable.

## Actions

| Action | Action Cost | Fund Cost | Min Relationship | Effect |
| --- | --- | --- | --- | --- |
| Request Endorsement | 6 | ₳0 | none | Request a public endorsement; willingness depends on relationship + policy fit |
| Private Meeting | 3 | ₳0 | -50 | +5 relationship |
| Boost Favorability | 5 | ₳10K | none | +3 favorability, +2 relationship |
| Reduce Favorability | 5 | ₳10K | -100 | -3 favorability, -2 relationship |
| Boost Influence | 6 | ₳20K | none | +2 political influence, +2 relationship |
| Reduce Influence | 6 | ₳20K | -100 | -2 political influence, -2 relationship |

## Action details

### Request Endorsement

The most expensive action at 6 character actions, but costs no funds. You ask the NPP for a **public endorsement**. Whether they agree depends on two factors:

1. **Relationship**: how warmly they view you
2. **Policy fit**: how closely their policy positions align with yours

A high-relationship NPP with strong policy alignment is likely to endorse; a hostile one with divergent policy views will refuse. Endorsements are publicly visible and can sway other NPPs and voters.

### Private Meeting

A cheap, reliable relationship builder. Costs only 3 actions and no funds, but requires a minimum relationship of **-50**: you cannot meet privately with an NPP who is openly hostile. Grants **+5 relationship**, making it the most efficient action per character action spent for improving standing.

### Boost / Reduce Favorability

Favorability is a distinct axis from relationship: it reflects how favorably the NPP views your policy direction rather than personal warmth. Both actions cost 5 actions and ₳10K:

- **Boost:** +3 favorability, +2 relationship
- **Reduce:** -3 favorability, -2 relationship (requires min relationship of -100, effectively always available)

### Boost / Reduce Influence

Political influence is how much sway the NPP carries in their party and legislature. Changing it is the most expensive action type at 6 actions and ₳20K:

- **Boost:** +2 political influence, +2 relationship
- **Reduce:** -2 political influence, -2 relationship

Boosting an ally's influence makes them a more powerful friend; reducing a rival's influence weakens their ability to oppose you.

## Determinism

All Political Capital actions are **fully deterministic**. There is no success chance, no randomness, and no hidden roll. If you have the required actions, funds, and minimum relationship, the effect is guaranteed. This makes Political Capital a planning tool: you can calculate exactly how many turns and how much money it will take to move an NPP from their current state to a target state.

## Ledger and audit

Every action writes a ledger entry:

| Field | Description |
| --- | --- |
| Relationship Before | Relationship value before the action |
| Relationship After | Relationship value after the action |
| Actions Spent | Character actions consumed |
| Funds Spent | Campaign funds spent (₳) |

The ledger is per-NPP, so you can reconstruct the full history of interactions with any given politician. This is useful for diagnosing why an NPP's relationship is at its current value and for auditing whether an action was applied correctly.

## Strategic notes

- **Private meetings are the best relationship-per-action value** (+5 relationship for 3 actions), but only work on NPPs above -50 relationship.
- **Favorability and influence are separate axes.** An NPP can have high relationship but low favorability (they like you personally but disagree with your policies) or high influence but low relationship (they are powerful but hostile).
- **Reducing a rival's influence** is often more impactful than boosting an ally's, because a weakened rival can no longer effectively oppose your legislation.
- **Endorsements cascade.** A well-timed endorsement from a high-influence NPP can shift other NPPs' willingness to support you.

## Related systems

- **[NPPs Overview](/wiki/npps-overview)**: What non-player politicians are and how they behave
- **[NPP Behavior](/wiki/npp-behavior)**: How NPP relationship and favorability evolve over time
- **[Party Organization](/wiki/party-organization)**: How NPPs organize within parties
- **[Campaign Finance](/wiki/national-budget)**: Where campaign funds come from
`;
