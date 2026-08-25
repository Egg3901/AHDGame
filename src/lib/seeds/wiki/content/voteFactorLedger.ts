export const voteFactorLedgerContent = `# Vote Factor Ledger

The factor ledger answers "why does each candidate have the votes they have" for a presidential general. It breaks every candidate's national vote total into the pieces that built it, so you can see whether a lead came from policy fit, name recognition, turnout, the national mood, or ground game.

It reads numbers the vote engine already computed. It never re-runs the vote math, so the ledger always adds back up to the real result.

## How to read it

The ledger is a waterfall. It starts from a structural baseline and adds a signed contribution for each factor:

**baseline + sum of every factor's vote delta = final votes**

Each factor shows a **vote delta**: how many votes that factor added (positive) or removed (negative). A few structural factors also show a **multiplier** for quick reading (for example a 1.20 on Policy fit means that factor lifted the baseline by 20%). The multiplier is display only; the vote delta is the real, conserved number.

## The factors

| Factor | What it means |
| --- | --- |
| **State lean & standing** | The structural base: each state's partisan lean, party organization, registration, regime, and the approval that favorability drives. |
| **Policy fit** | Ideological and positional alignment with the electorate. Pure platform fit, with no influence or favorability mixed in. |
| **Name recognition** | The reach a candidate's national political influence buys. In the general, influence feeds recognition only, never policy fit. |
| **Turnout** | How the state's turnout level scales the vote up or down. |
| **Persuasion swing** | Net votes moved by the turn-to-turn persuasion (swing) flow. |
| **Spoiler effect** | Votes gained or lost through first-past-the-post spoiler transfers between candidates. |
| **National mood** | The economy-as-referendum shift: the national environment rewarding or punishing the field. |
| **Campaign** | Ground game: state presence, canvassing, the running mate, governors, and campaign strength. |
| **Other** | A small residual that absorbs rounding so the waterfall reconstructs to the exact vote total. |

## What you can see, and what only you can see

- **Public:** the national waterfall above is visible for **every candidate**. Anyone can see how a rival's vote total was built.
- **Owner only:** where your support comes from **by voter bucket** (which census groups back you), and the per-state ledgers for your **closest states**. These are stripped for candidates you do not own. Admins can see everyone's.

The per-state ledgers cover the tightest races, the ones where the factor mix actually decides the state.

## Related

- [General Elections](/wiki/general-elections): how general-phase votes accumulate.
- [Live Election Results](/wiki/live-election-results): the results page the ledger sits on.
- [Campaign Manager](/wiki/campaign-manager): the owner-only briefing that turns these factors into a plan.
- [Demographics & Targeting](/wiki/demographics-targeting): the bucket appeal the owner-only view breaks down.
`;
