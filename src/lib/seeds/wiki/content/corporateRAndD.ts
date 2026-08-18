export const corporateRAndDContent = `# Corporate R&D & Tech Trees

Corporations invest in research through two linked systems: a **Tech tab** with decade-gated **tech trees**, and a background **R&D Score** that still drives periodic innovation breakthroughs. Both spend from the same daily R&D budget and share the overhead cap.

## Tech trees overview

Every corporation has a **Tech** tab listing research nodes organized by **decade tier**. The world's current calendar year (derived from the active era preset plus elapsed game years) determines which decades are researchable: earlier decades are hidden, and future decades appear locked until the clock reaches them.

Each decade forks into two **lanes**:

| Lane | Scope | Contents |
| --- | --- | --- |
| **Corporate** | Shared across all sector types | Business functions: automation, analytics, marketing, logistics, etc. |
| **Sector** | Unique to your corporation's primary type | Specialist methods for energy, manufacturing, technology, extraction, and so on |

You **commit to one lane per decade** on first unlock. The other lane locks until you **abandon** that decade's progress (forfeiting lane-specific nodes).

Completing either lane opens a final **specialization tier** for that decade:

| Specialization | Focus |
| --- | --- |
| **Scale** | Lower input, wage, and expansion costs |
| **Premium** | Higher realized prices and stronger brand effects |
| **Resilience** | Protection from dominance penalties and tariffs, plus cheaper expansion |

You may complete exactly one specialization per decade. Choosing one locks the other two. Switching requires abandoning that decade and giving up its lane-specific and specialization progress. Specializations cost twice the decade's base research cost, and their capstones cost three times the base cost.

## Unlocking nodes

Each node has a dual cost:

- **R&D Score**: spent from the corporation's accumulated score (see below).
- **Cash**: a fraction of daily gross revenue (varies by node; heavier nodes cost more).

Additional gates:

- **Decade reached**: the world clock must have entered the node's decade.
- **Prerequisites**: earlier slots in the same lane must be owned.
- **Method unlocks**: some sector nodes unlock new operating strategies that stay locked until researched.

Unlocks are atomic: insufficient R&D or cash rejects the purchase, and lane commitment is enforced so you cannot buy both Corporate and Sector tracks in the same decade without abandoning first.

## Node effects

Tech nodes grant persistent bonuses, including:

- Profit **margin** bumps
- **Marketing** or **logistics** strength grants
- **Growth cost** reductions
- Input-cost, wage, output, and realized-price changes
- Protection from tariff and dominance penalties
- **Strategy unlocks**: gates advanced operating strategies behind research

Effects stack with normal sector modifiers and apply for the life of the corporation (until a reset removes the corp).

## R&D score and daily budget

Set a daily **R&D budget** from the CEO Budget tab. Each turn:

\`\`\`
baseGain = 1.0 (if any R&D budget is set)
scaledGain = 0.65 × ln(1 + budget / 100,000)
decay = 3% of current score
newScore = max(0, (1 − 0.03) × oldScore + (baseGain + scaledGain) × diminishing(oldScore))
\`\`\`

| Property | Value |
| --- | --- |
| Starting score | 0 |
| Decay per turn | 3% of current score |
| Diminishing returns above | Score 100 |

R&D spending counts toward the **150% overhead cap** alongside marketing, logistics, and CEO salary.

Tech-tree unlocks **spend down** the score immediately; the budget keeps refilling it for the next node.

## Innovation breakthroughs (legacy loop)

Every **6 turns**, the game rolls for a **breakthrough** independent of tech-tree purchases:

\`\`\`
probability = min(1, rdScore / 200)
\`\`\`

| R&D Score | Chance per 6-turn window |
| --- | --- |
| 100 | 50% |
| 200 | 100% |

On success, one random sector receives a **revenue boost** (1-5% regular corps, 1-3% extraction). Extraction corps also gain permanent **state resource capacity**. Breakthroughs notify the CEO in-game.

Tech trees and breakthroughs complement each other: trees give targeted permanent power, and breakthroughs add random sector growth on top.

## Strategic notes

- **Lane and specialization choices matter**: Corporate lane bonuses help every sector; Sector lane unlocks methods and margins specific to your industry; the final specialization decides whether that decade favors scale, premium output, or resilience.
- **Decade timing**: a 2019-start world only researches the final tiers; a 1979-start world walks the full tree over decades.
- **Cash + score planning**: nodes near the top of a decade cost more R&D and a larger cash slice of daily revenue; fund R&D before a unlock push.
- **NPP corporations**: autonomous CEOs (NPP autonomy v1+) can unlock affordable nodes when the feature is enabled.

## Related

- [Corporations](/wiki/corporations): CEO tools, operating strategies, overhead cap
- [Commodities](/wiki/commodities): Price realization and margin modifiers
- [Corporate Bonds](/wiki/corporate-bonds): Financing R&D-heavy expansion
`;
