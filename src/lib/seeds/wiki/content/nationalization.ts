export const nationalizationContent = `# Nationalization & National Corporations

Nationalization is the **state-ownership lifecycle**: a government can take a private corporation (or one of its sectors) into public hands, run it as a state-owned enterprise, and later sell it back to the market. Every country has a single central **National Corporation** that absorbs what the state takes over, plus optional split-offs for individual sector types.

\`\`\`
private corp ──(nationalize: absorb)──▶  National Corporation  ──(privatize: spin out)──▶  new private corp
\`\`\`

The two directions are inverses of one another. Nationalizing folds a target's sectors, assets, and bonds into the country's National Corporation and dissolves the original shell. Privatizing carves a new, independently named corporation back out and floats it to investors.

## When the state can take a corporation

Unowned and NPC assets can be nationalized freely. A **player-owned** corporation is protected: the state may only reach it when one of four conditions unlocks the target.

| Trigger | Condition | Notice |
| --- | --- | --- |
| **Financial distress** | The corp's CEO seat has sat vacant for 72 turns (an abandoned firm). | Seized at once, no notice. |
| **Strategic sector** | The corp operates in a sector the government has designated strategic. | 48 turns. |
| **Monopoly** | The corp holds 75% or more of a national sector market. | 48 turns. |
| **Supermajority vote** | The legislature passes a taking with a two-thirds majority. | 48 turns. |

The **notice window** is counterplay. When a strategic, monopoly, or supermajority taking is filed, the target owner sees a pending notice and has those turns to respond (sell down a monopoly share, fill a vacant CEO seat, restructure, or rally political opposition) before the taking completes. Only genuinely abandoned firms (distress) are taken immediately.

Each country starts with a set of **default strategic sectors** flavored to its economy (for example, defense and technology for the United States, financial and energy for the United Kingdom). A head of government can designate further sectors strategic through executive action or legislation.

## Authority: who pulls the trigger

There are two authority paths, and the path determines how much the state must pay.

**Executive**: fast and unilateral, available to the head of government for emergencies, but limited in reach and politically expensive when used as a seizure. Executive takings can apply discounted or token compensation.

**Legislative**: slow and durable. A taking enacted through a bill carries full statutory weight and is expected to pay a **fair** buyout. The supermajority path is a special legislative route that unlocks any target with a two-thirds vote.

## Compensation tiers

Shareholders are paid against the target's valuation, scaled by the tier the authority used.

| Tier | Shareholders receive | Typical path |
| --- | --- | --- |
| **Fair** | Full valuation. | Legislative buyout. |
| **Discounted** | Half valuation. | Executive emergency. |
| **Seizure** | Nothing. | Executive seizure (maximum political cost). |

Valuation discounts future sector cash flows at the same rate corporations use for their own net-present-value math, so the buyout price tracks the going concern rather than a sticker number. On top of the tier multiplier, the state pays a **5x premium** over that capitalized-earnings valuation: a Fair-tier buyout is not "1x valuation" in practice, it's 5x the discounted earnings stream, tier multiplier included. This reflects the going-concern value of a business as a whole, not a fire-sale liquidation price.

## Investor confidence

Every country carries an **investor-confidence index** from 0 to 100, healing toward a baseline of 70 a little each turn. Takings push it down: a fairly-paid buyout barely moves it, while an uncompensated seizure takes a large bite. A statist government pays less confidence for a taking; a market-liberal one pays more. Popular takings (rescuing a distressed firm, breaking up a monopoly) can even nudge public trust upward.

Confidence is not cosmetic. As it falls below baseline it feeds three real pressures:

1. **Expropriation risk** drags private corporate margins (state-owned enterprises are exempt).
2. **Sovereign risk premium** raises the interest rate the government pays on new debt.
3. **Founding surcharge** raises the cost to incorporate a new company in that country, up to +25% at rock-bottom confidence.

Privatizing sends the opposite, pro-market signal and restores some confidence.

## Operating a state-owned enterprise

Once absorbed, sectors run under the National Corporation rather than as a sprawl of separate firms. SOE behavior is distinct from a private corp:

- **Dynamic efficiency.** Instead of a flat penalty, an SOE's margin drag scales with governance. A well-run, transparent, low-corruption state runs its enterprises close to private efficiency; a corrupt one bleeds margin.
- **Public-service mandates.** A National Corporation's sectors can be put under mandates that nudge state metrics (employment, infrastructure reliability, cost of living) at a small but compounding per-turn rate.
- **Price controls.** A price-controlled mandate trades extra margin drag for a stronger public-service contribution.
- **Treasury backing.** SOE operating profit is remitted into the national budget as public-enterprise revenue.

The finance minister (Secretary of the Treasury, Chancellor, and equivalents) manages the country's National Corporations: appointing CEOs, splitting a sector type off into its own named enterprise, and merging one back in.

For the full operating manual, covering the National Corporation page and its tabs, public-service mandates, the CEO's four operating levers, the two-actor financing model, treasury backing and remittance, dynamic efficiency, and state-ownership concentration, see the companion page on [National Corporations](/wiki/national-corporations).

## Privatization

Privatization is the inverse operation: the state carves a fraction of a sector out of the National Corporation into a **brand-new corporation** with its own name, then floats it by IPO or auction.

- **Carve fraction** of the National Corporation's holding in a sector is between 10% and 100% per spin-out. That's a separate cap from the anti-monopoly rule: a spun-out corp can never end up controlling more than 30% of the whole (state, sector-type) market, so a National Corp that dominates a market is forced into several separate spin-outs even though any single carve fraction could be as high as 100%.
- **Golden share.** The state may retain up to 40% of a spun-out corporation to keep a strategic foothold.
- **Auctions** run for a bid window of 48 turns.
- **Cooldowns.** A privatized corp cannot be re-nationalized for 168 turns, and a freshly absorbed sector cannot be privatized for 168 turns, preventing churn in either direction.

## Political weight

Nationalization is never free. Beyond investor confidence, a taking can cost regime legitimacy and government approval, scaled by how unpopular it is and by the government's ideological lean. Statist governments find takings cheaper and privatizations costlier; market-liberal governments find the reverse. Plan the politics before you plan the takeover.
`;
