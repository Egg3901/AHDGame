export const unionsContent = `# Unions

The union system adds **sector unionization**, **standing labour premiums**, **strikes**, and (at full tier) **player-run unions** and **union-busting**. It builds on [Labour & Wages](/wiki/labour-and-wages): wage level, minimum-wage protection, and macro feedback must be live before union mechanics matter.

## Unionization

Each corporate sector carries a **unionization** score (0 to 100). It drifts toward a target each turn based on:

| Factor | Direction |
| --- | --- |
| Real wages below cost-of-living-adjusted expectations | ↑ pressure |
| High unemployment | ↓ pressure |
| Weak minimum-wage protection (low Kaitz ratio) | ↑ pressure |
| Pro-labour union law (country legislation) | ↑ pressure |
| Player-run union recruitment in that sector | ↑ pressure |

At **unions** tier, high unionization adds a **standing premium** to labour cost: a persistent surcharge, not a temporary event.

## Strikes

When unionization is high **and** real wages lag a slow-moving **worker expectation index** by enough, a sector can enter a **strike** (bounded-duration event):

- **Revenue throttle**: active strikes cut sector revenue (~25%).
- **Margin penalty**: additional profit-margin hit while the strike runs.
- **Resolution paths:**
  - **Concession**: CEO raises wage level until the expectation gap closes; strike ends, cooldown begins.
  - **Wait it out**: strike expires after a fixed duration; unionization bumps up ("radicalization").
  - **Union-busting** (full tier): CEO action to break the strike; see sector union-busting controls.

A **cooldown** after every strike prevents immediate re-trigger. Trigger and concession thresholds are separated (hysteresis) so wages cannot be oscillated to game the system.

## Union law

At **full** tier, countries can enact **union-law** legislation on a right-to-work ↔ collective-bargaining axis. The active option biases:

- Unionization drift targets
- Strike trigger thresholds (easier or harder to walk out)

Union law gives governments a political lever independent of corporate wage sliders.

## Player-run unions

At **full** tier, players can found and operate **unions** covering a country + sector type. Owned unions contribute **membership pressure** to unionization drift in matching sectors: organizing becomes a gameplay loop parallel to running a corporation.

Union pages live under \`/unions\` when the feature is enabled for your world.

## Union-busting

CEOs (full tier) can attempt **union-busting** on a striking or highly unionized sector. Success reduces unionization; failure can backfire. Costs and cooldowns apply: it is a high-risk management tool, not a free reset.

## Phased rollout

| Tier | Unions content |
| --- | --- |
| **unions** | NPC unionization drift, standing premium, strikes |
| **full** | Union-law bias, union-busting, player-run unions |

Admins enable tiers via \`labourSystemMode\`; a world can run wages and macro without strikes until the next tier is flipped.

## Related

- [Labour & Wages](/wiki/labour-and-wages): wage slider, minimum wage, macro links
- [Corporations](/wiki/corporations): sector labour costs and CEO tools
- [Bills & Legislation](/wiki/bills-legislation): union-law provisions
- [National Metrics](/wiki/national-metrics): unemployment and median income context
`;
