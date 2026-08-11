export const nppBehaviorContent = `# NPP Behavior

NPPs make autonomous decisions every turn: how to vote on bills, whether to vote in leadership elections, and how to respond to whip directives. Understanding this decision-making system lets you predict NPP behavior and use it strategically.

## Bill voting

NPPs vote on all active federal bills. State/regional bills are not currently processed by the NPP system.

### The vote decision

Each turn, NPPs that haven't yet voted on an open bill evaluate it using a deterministic cross-pressure model. Four signed forces are summed:

1. **Ideology**: alignment between the NPP's positions and the bill's positions
2. **Whip**: if a whip directive exists, it contributes a signed force (positive for FOR, negative for AGAINST)
3. **District**: constituency pressure based on the NPP's home state demographics
4. **Donors**: donor-class pressure based on the NPP's donor alignment

The total is the sum of all four signed forces. The verdict is:

| Verdict | Condition |
| --- | --- |
| **For** | Total ≥ +5 |
| **Against** | Total ≤ −5 |
| **Abstain** | \|total\| < 5 (i.e., cross-pressure is too close to call) |

This is a deterministic model, not a probabilistic one. There is no random roll or compliance chance.

### Whip force details

A **soft whip** contributes a base force of **30**. A **hard whip** contributes a stronger base force of **60**. However, even a hard whip is not binding: the whip force is still multiplied by the NPP's compliance multiplier before being added to the total. The compliance multiplier is derived from loyalty and stubbornness, but the final vote is always determined by the summed-force threshold.

### Multi-seat weighting

NPPs holding multiple seats contribute their full seat count to the vote tally. An NPP with 7 House seats casts 7 effective votes. This matters enormously: a well-seated NPP bloc in a closely divided legislature can swing any bill.

### Catch-up voting

NPP bill voting runs every turn throughout the bill's open window. NPPs who gain seats after a bill opens still vote before it closes, as long as voting hasn't ended. Once an NPP has voted, they cannot change their vote.

## Personality traits

Three personality traits shape how predictable an NPP's behavior is:

| Trait | Range | Effect |
| --- | --- | --- |
| **loyalty** | 0 to 100 | Higher loyalty = stronger compliance multiplier, more party-line bill votes |
| **ambition** | 0 to 100 | Higher ambition = more aggressive election entry |
| **stubbornness** | 0 to 100 | Higher stubbornness = weaker compliance multiplier, harder to whip |

The compliance multiplier scales loyalty against stubbornness. It is not a probability; it is a scalar that reduces or amplifies the whip force before it enters the deterministic sum.

## Strategic implications

- **Bill passing**: If you need an NPP-heavy chamber to pass a bill, align the bill with the ideological center of the majority NPPs, or whip your state's NPPs to vote For
- **Blocking opponents**: If a rival is running for Speaker, identify the most stubbornness-resistant NPPs in your party and whip them away from the rival's party block

## Related

- [NPPs Overview](/wiki/npps-overview): What NPPs are and the influence action system.
- [NPP Elections](/wiki/npp-elections): How NPPs enter and compete in elections.
- [Party Actions](/wiki/party-actions): Whip directives, party-level NPP influence.
- [Party Ideology](/wiki/party-ideology): The ideology alignment formula.
`;
