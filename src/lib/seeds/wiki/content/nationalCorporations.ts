export const nationalCorporationsContent = `# National Corporations

A **National Corporation** is the state's own enterprise: the single container into which a government folds everything it takes into public hands, and the vehicle it uses to deliver public services, prop up strategic industry, and feed profit back to the treasury. Where a private corporation answers to shareholders, a National Corporation answers to the state: it cannot go bankrupt, it pays no dividends to investors, and its profits are remitted to the national budget.

This page covers the National Corporation as a *thing you run*: its structure, who controls it, what it does for the country, and how to operate it well. For the rules on **how a government takes a corporation in the first place** (eligibility, triggers, compensation tiers, notice windows), see the companion page on [Nationalization](/wiki/nationalization).

\`\`\`
private corp ──(nationalize: absorb)──▶  National Corporation  ──(privatize: spin out)──▶  new private corp
\`\`\`

## Structure: primary and split-offs

Every country has **one primary National Corporation** plus **zero or more split-offs**. The primary is the catch-all: it holds every sector type that hasn't been carved out on its own, and it is the entity the state's sovereign bonds are issued against. A **split-off** is a secondary National Corporation that owns exactly one sector type (for example, a dedicated state rail or energy company carved out of the primary).

When the state nationalizes an asset, each seized sector is **routed to the National Corporation that owns its sector type**: a split-off if one claims that type, otherwise the primary. A whole-company taking that spans several sector types fans its sectors out to the right corporations automatically.

The primary is labelled **Primary** in the page masthead; a split-off shows its sector type (e.g. "energy split-off").

## The National Corporation page

Each National Corporation has its own page, organized into tabs. Which tabs you see depends on who you are:

| Tab | Who sees it | Purpose |
| --- | --- | --- |
| **Overview** | Everyone | Headline stats: revenue, treasury remittance, sectors, regions, jobs, investor confidence, efficiency. |
| **Public Mandates** | Everyone (officials can edit) | Which state metrics each holding improves, and its public-service posture. |
| **Holdings** | Everyone | Every sector the corp owns, by region: revenue, margin, market share, and how it was acquired. |
| **Register** | Everyone | The country's full state-ownership history, investor-confidence meter, and the governing bloc's political standing. |
| **Operations** | The seated **CEO** only | The four operating levers and the profit-retention setting. |
| **Nationalize** | The **head of government** | Take new assets and designate strategic sectors. |
| **Privatization** | The **finance minister** | Carve a holding back out and float it. |

Officials toggle between a **Public** view and a **State Official** view; the official session warns that actions execute against the live economy.

## Who controls a National Corporation

Authority is deliberately split between three seats so no single player runs the whole machine:

- **Head of government**: designates strategic sectors and authorizes takings (the Nationalize surface).
- **Finance minister** (Secretary of the Treasury, Chancellor, Minister of Finance, and equivalents): the ministry that *owns policy*: appoint or remove the CEO, set public-service mandates, split off or merge back sector types, set the CEO's treasury-draw cap, and privatize. If the finance portfolio is vacant, the head of government can act as a fallback so no country is ever locked out.
- **CEO**: runs day-to-day operations within the policy and budget the ministry sets. A CEO is *appointed* by the ministry, not elected by shareholders (a National Corporation has none), and the finance minister may appoint themselves. A National Corporation CEO may not also be CEO of any other company.

The clean line: **the ministry sets policy; the CEO runs operations.** A CEO cannot set mandates, take or sell assets, or raise their own budget cap.

## What National Corporations are for: public mandates

The reason to own an enterprise rather than tax a private one is the **public-service mandate**. Each turn, an SOE's sectors push the state metric they're matched to, slowly but durably, because policy effects decay only gradually. The more of a region's sector the state owns, the larger the nudge.

| Sector type | What it improves |
| --- | --- |
| Healthcare | Physician capacity |
| Energy | Power-grid reliability |
| Logistics / automobiles / construction | Road condition |
| Telecommunications / technology | Broadband access |
| Agriculture | Food security |
| Manufacturing / chemicals | Manufacturing competitiveness |
| Defense | Public trust (Germany: Bundeswehr readiness) |
| Financial | Small-business formation, and lower income inequality |
| Retail | Lower cost of living |
| Real estate | Housing affordability |

Two **postures** let the ministry trade profit for public value, set corp-wide or overridden per sector:

- **Price-controlled**: forces low consumer prices and high output. It *strengthens* the public-service contribution but costs extra operating margin. The forgone profit shows up as a "mandate subsidy" the treasury effectively pays.
- **Employment-guaranteed**: the SOE acts as employer of last resort and keeps a worker floor, easing unemployment, at a smaller margin cost.

## Running the enterprise: the CEO's four levers

From the **Operations** tab, the seated CEO grows the corporation using four state-appropriate levers (no marketing, no market bond issuance, since those aren't state-appropriate):

1. **Capacity investment**: fund a sector's growth so its output (and revenue, remittance, jobs, and citizens served) expands over turns.
2. **Modernization (R&D)**: build the corp's innovation momentum toward a breakthrough.
3. **Production**: set a per-sector output target (roughly −25% to +25%); the active level trends toward it about one point per turn. Higher production raises revenue, which grows the workforce organically.
4. **Treasury capital draw**: pull cash from the national budget into the corp to finance the above, up to the ministry's cap.

All spending is funded from the corp's own working capital (or a treasury draw); the engine consumes it as a genuine expense. Money is always conserved: nothing is minted.

## Financing: a two-actor model

The financing system has built-in tension between the CEO and the minister:

- **Profit retention (CEO-set).** Each turn the corp's operating profit splits between what stays in the corp (a reinvestment war-chest) and what is **remitted to the national budget**. The CEO sets retention between **0% and 75%**: at least **25% always remits** to the budget, a floor neither actor can breach. The default is to remit everything.
- **Treasury-draw cap (minister-set).** The minister sets a **per-turn ceiling** on how much the CEO may pull from the budget. Setting it to **0 freezes draws entirely**: the lever the ministry uses to rein in a CEO for fiscal or political reasons.

So the CEO can self-fund by retaining profit *or* lean on the treasury up to the cap, but can never raise that cap, and can never starve the budget below the remittance floor.

### Treasury backing: SOEs can't go bankrupt

If a National Corporation runs an operating loss, the treasury automatically covers the shortfall and the corp's cash is restored to zero: it never defaults. This is what makes mandates like price control viable: the state knowingly funds a money-losing public service. The flip side is that a loss-making SOE is a real, ongoing **drain on the national budget**.

## Efficiency: governance matters

There is no flat "state-run penalty." Instead, an SOE's operating margin carries a **dynamic efficiency drag** that depends on how well the country is governed:

- A well-run, transparent, low-corruption state runs its enterprises close to private efficiency (a single-digit drag).
- A corrupt one, or one leaning hard on price controls, bleeds far more margin (toward roughly −25 percentage points).

Good governance, low corruption, and a light mandate touch keep an SOE profitable; corruption and heavy price controls push it toward losses. The Holdings drill-down breaks the penalty down so you can see exactly where the drag comes from.

## The cost of empire: concentration and confidence

Nationalization is meant to be a real but *costly* tool, and the cost escalates the more of the economy the state already owns. Two linked gauges, both on the **Register** tab, drive this:

- **State Ownership Concentration Index (SOCI), 0 to 100**: the share of the country's corporate economy that the state owns, revenue-weighted. Below a danger zone (around a third of the economy) it does almost nothing; past it, every new taking costs more political capital, scars investor confidence harder, and takes longer to digest. A sprawling state sector also runs *somewhat* less efficiently (an "overreach" drag), though a well-run economy can still be profitable long-term; the cost is front-loaded, not permanent.
- **Investor confidence, 0 to 100 (baseline 70)**: a national mood that *heals back toward baseline each turn* (about 5% of the gap). Fairly-paid, popular takings (rescuing a failing firm, breaking a monopoly) barely move it; expropriating healthy private firms, especially cheaply, takes a real bite, amplified by how much the state already owns.

Low confidence isn't cosmetic. It feeds three live systems shown as tiles on the Register tab:

1. **Private-corp margins**: an expropriation-risk drag on surviving private firms (SOEs are exempt).
2. **Sovereign borrowing**: a risk premium on the government's own bond rate.
3. **New-corp founding**: a surcharge on the cost to incorporate (up to **+25%** at rock-bottom confidence), dampening private growth.

A statist governing bloc pays less of this political cost; a market-liberal one pays more. The Register tab reads your bloc's stance and labels how expensive nationalizing versus privatizing currently is.

## Restructuring: split-offs and merge-backs

The finance ministry can reorganize the state's holdings without any money changing hands (a National Corporation has no shareholders to compensate):

- **Split off a sector type** into a new, named secondary National Corporation. Every holding of that type moves into it. You can even pre-create an empty one to claim routing for a type before you own any of it. Only one National Corporation may own a given sector type per country.
- **Merge a split-off back** into the primary (or another National Corporation). Its sectors move over and the now-empty shell is dissolved.

Splitting lets you give a strategic industry its own CEO, mandate posture, and books; merging consolidates when that's no longer worth the overhead.

## Privatization: the relief valve

Selling assets back to the market is the genuine way down from a high SOCI: it lowers concentration, **raises investor confidence (+5)**, and is politically rewarded for market-leaning governments. The finance minister carves a **brand-new, named corporation** out of a National Corporation's holding and floats it:

- **Carve size is market-capped.** A spin-out may not end up controlling more than **30% of its regional market**: so a small holding can be sold in full, but breaking up a dominant state position requires several separate spin-outs (an anti-monopoly guard).
- **Method: IPO or auction.** An IPO releases shares to the public float at a floor price, with proceeds crediting the treasury; an auction runs a bid window (48 turns) and hands the winner the company. An auction that closes below reserve simply folds the carve-out back into the National Corporation.
- **Golden share.** The state may retain up to **40%** of a spun-out corporation: a minority stake with a veto over relocation and dissolution, whose dividends flow to the treasury.
- **Cooldowns.** A freshly privatized corp can't be re-nationalized, and a freshly absorbed sector can't be privatized, for **168 turns** each, preventing seize-sell-seize churn in either direction.

## Acquiring assets (in brief)

Unowned and NPC assets can be nationalized freely. A **player-owned** company is protected and can only be taken when a trigger unlocks it: financial distress (an abandoned or insolvent firm), operating in a designated strategic sector, holding a near-total (75%+) market monopoly, or a legislative supermajority (two-thirds) vote. Most takings post a **notice window** (48 turns) so the target can respond. Compensation is paid at a steep premium over a company's going-concern value, scaled by the tier the authority uses. The full rules live on the [Nationalization](/wiki/nationalization) page.

## Strategy notes

- **Own things that pay you back in metrics, not just cash.** A price-controlled utility or a guaranteed-employment heavy industry may run thin or at a loss, but the durable lift to grid reliability, food security, or unemployment can be worth more than the profit you gave up.
- **Watch the concentration gauge.** The first nationalization is cheap; the twentieth, with a third of the economy state-owned, is a real fiscal and political liability. Keep an eye on SOCI before the next taking.
- **Privatize to reset.** If confidence is suppressed and SOCI is high, selling a few mature holdings restores room to maneuver, and a market government gets paid politically for doing it.
- **Mind governance.** Fighting corruption and improving transparency quietly raises every SOE's margin at once. A clean state runs a profitable public sector; a corrupt one runs a money pit.
- **Use the two-actor budget deliberately.** A minister who trusts a CEO raises the draw cap and lets them retain profit to invest; a minister who doesn't can freeze the cap to 0 and force full remittance.

## See also

- [Nationalization](/wiki/nationalization): the taking lifecycle: eligibility, triggers, compensation, and counterplay.
- [Corporations](/wiki/corporations): how private corporations, sectors, and margins work.
- [National Budget](/wiki/national-budget): where remittance, compensation, and loss-backing land.
- [National Metrics](/wiki/national-metrics): the state metrics public mandates improve.
`;
