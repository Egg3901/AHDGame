export const caucusesContent = `# Caucuses

Caucuses are organized blocs of NPPs (non-player politicians) within a party that share an agenda, ideology, or factional alignment. The **caucus health** system tracks how stable a caucus is by monitoring member churn, election status, and at-risk NPP retention over a rolling window.

## Caucus health snapshot

The caucus health snapshot is a per-caucus diagnostic that answers one question: **is this caucus about to fall apart?** It combines several signals into a single health label.

### Churn tracking

The snapshot tracks **churn**: the rate at which members enter and leave the caucus. Three churn event types are counted:

| Event | Description |
| --- | --- |
| \`join\` | An NPP joined the caucus |
| \`leave\` | An NPP left voluntarily |
| \`forced_exit\` | An NPP was removed against their will |

Churn is measured over a **recent window of 12 turns**. High churn in that window is a warning sign; low churn indicates stability.

### Election status

The snapshot includes the caucus's **election status**: whether the caucus is currently involved in an internal election (e.g., leadership contest) or is in a stable non-election period. Active elections can temporarily destabilize a caucus even if churn is low.

### At-risk NPP retention

The most important diagnostic is the **at-risk member list**. The snapshot identifies NPPs who are at risk of leaving the caucus and labels them by severity.

## Constants

| Constant | Value | Description |
| --- | --- | --- |
| Recent window | 12 turns | The rolling window over which churn is measured |
| Warning buffer | 10 | Buffer applied before flagging a member as at-risk |
| \`CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP\` | From \`partyOrg\` constants | Minimum relationship with the chair required for an NPP to remain in the caucus |

## Health labels

Each caucus is assigned one of three **health labels**:

| Label | Meaning |
| --- | --- |
| **Healthy** | Low churn, no at-risk members, stable elections |
| **Strained** | Moderate churn or some at-risk members |
| **Fragile** | High churn, multiple critical-risk members, or active destabilizing elections |

## At-risk members

For each at-risk NPP, the snapshot records:

| Field | Description |
| --- | --- |
| \`relationshipWithChair\` | The NPP's current relationship with the caucus chair |
| \`gapFromExit\` | How far the NPP is from the exit threshold (negative = already past it) |
| \`exitRiskLabel\ | Severity label: **\`Critical\`**, **\`Elevated\`**, or **\`Watch\`** |

### Exit risk labels

| Label | Meaning |
| --- | --- |
| **\`Critical\`** | The NPP is at or past the exit threshold: departure is imminent |
| **\`Elevated\`** | The NPP is close to the exit threshold and trending poorly |
| **\`Watch\`** | The NPP is worth monitoring but not yet in danger |

The **warning buffer of 10** is applied when computing these labels: it provides a margin so that a member is not flagged as \`Critical\` the instant their relationship dips below the threshold, giving the chair time to intervene.

## Whip defiance snapshot

The caucus health snapshot is **integrated with the whip defiance system**. When a whip is issued and NPPs defy it, those defiance events feed into the at-risk assessment. An NPP who repeatedly defies the whip is likely to appear in the at-risk list with an elevated or critical risk label, even if their raw relationship with the chair is still positive.

## Strategic notes

- **Watch the 12-turn window.** A sudden spike in \`forced_exit\` events is the earliest sign of caucus fragmentation.
- **Relationship with the chair is the key variable.** Most at-risk members are flagged because their \`relationshipWithChair\` has fallen below or near \`CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP\`. Use [Political Capital](/wiki/political-capital) actions (especially private meetings) to repair relationships before members leave.
- **Whip defiance is a leading indicator.** If members start defying whips, expect the at-risk list to grow. Address the underlying policy disagreement before it becomes a departure.
- **Elections destabilize.** Even a healthy caucus can show a \`Strained\` label during a leadership contest. This is usually temporary.

## Related systems

- **[Political Capital](/wiki/political-capital)**: How to repair relationships with at-risk NPPs
- **[Voting and Whips](/wiki/voting-and-whips)**: How whip defiance is tracked
- **[Party Organization](/wiki/party-organization)**: How caucuses fit into the broader party structure
- **[NPP Behavior](/wiki/npp-behavior)**: What drives NPP relationship changes
`;
