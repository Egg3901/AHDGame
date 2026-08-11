export const policyEffectsContent = `# Policy Effects

Every signed bill changes the law, and the law changes the country. This page explains how enacted policies affect national and state metrics each turn, how multiple policies stack, and what the long-run equilibrium looks like.

## Two levels of policy

The game tracks policy at two separate levels:

| Level | Scale | What it drives |
| --- | --- | --- |
| Character positions | −5 to +5 | Electoral appeal to demographic groups |
| Enacted law | −3 to +3 | Per-turn metric effects on states and nation |

Your personal policy positions (set at character creation or via the Policy Shift action) determine how well your ideology matches demographic groups in elections. Enacted legislation (bills that have been signed into law) determines what actually changes in the world.

## How enacted policy changes metrics

Every turn, the game recalculates the effects of every active piece of legislation. For each one, it applies three layers in sequence:

### 1. Exponential decay toward target

Each legislation type has a set of weighted effect targets: the metric values that policy "wants" the world to reach. Metrics don't jump to the target instantly; they move 2% of the remaining gap per turn:

\`\`\`
newValue = current + (target - current) x 0.02
\`\`\`

A metric that is 10 points away from its target closes 0.2 points per turn initially, then slows as it converges. This asymptotic approach means extreme legislation has immediate visible impact but takes many turns to fully manifest.

### 2. Direct tick rates

Policy options also carry flat additive per-turn changes, applied on top of the decay toward target:

- **Extreme policies:** approximately ±0.06 per turn
- **Moderate policies:** approximately ±0.02-0.04 per turn
- **Center policy:** 0 (no tick effect)

The tick-rate design targets approximately a 10-game-year full reversal from one extreme to the other. With 48 turns per game year, an extreme policy would take roughly 480 turns to shift a metric from floor to ceiling, without opposition.

### 3. Natural metric decay

When no active policy is pushing a metric, it drifts back toward its historical baseline at **0.25% per turn**. A metric fully deviated from baseline takes approximately 20 game years (~960 turns) to return with no opposing policy. This prevents the world from permanently freezing at whatever extreme legislation last pushed it to.

## Federal vs. state scope

Federal (national) bills affect every state, but each state receives only a fraction of the total effect:

| Country | Division factor | Per-region effect |
| --- | --- | --- |
| US | ÷ 50 | 1/50th of the full national effect |
| UK | ÷ 12 | 1/12th of the full national effect |

This means the sum of all state-level effects from a federal bill equals the intended national total. It prevents a single federal bill from dominating any one state's metrics while still mattering at the national level.

State-level legislation (US state laws, UK regional council acts) applies its full effect only to that state or region.

## Time-based decay (half-life)

Some legislation types model economic adaptation. A policy that disrupts the economy delivers its largest metric hit early, then fades as the economy adjusts:

| Half-life (turns) | Effect remaining after 1 game year (48 turns) |
| --- | --- |
| 24 turns | ~25% of original |
| 48 turns | ~50% of original |
| 96 turns | ~75% of original |

For example, a sudden defense-spending cut might hit GDP hard initially, but the private sector adapts. This is modelled by giving the defense legislation type a shorter adaptation half-life.

## Stacking multiple policies

The engine sums contributions from all active policies targeting the same metric:

\`\`\`
target = baseline + sum of contributions from each active policy
\`\`\`

Two bills pulling in opposite directions partially cancel each other. A healthcare spending increase and a healthcare spending cut enacted simultaneously would produce a net contribution somewhere between the two extremes, depending on their respective weights and current policy option values.

There is no artificial cap on how many policies can target the same metric, but the metric itself is clamped to a valid range.

## Demographic shifts

Active policies also slowly shift the composition of demographic groups within each state. This is a slower, longer-run effect:

- **Max shift rate:** 0.1% of the demographic group's population per turn
- **Extreme policy (±3):** Full 0.1%/turn shift rate
- **Moderate policy (±1):** ~0.033%/turn

Federal policies also apply at the divided rate (÷50 or ÷12) before computing demographic shifts. These shifts accumulate over game years, gradually making states more or less friendly to certain ideological profiles.

## Viewing current policy

- **National Policy page**: lists all federal policies grouped by domain, showing the current policy option name and economic/social positions.
- **State page, State Laws & Policy tab**: shows state-level base policy for a single state. Each row shows the policy area, current base option name, and positions.
- **Character profile**: shows your personal policy positions on the −5 to +5 scale, separate from enacted law.

## Strategic implications

### Pushing a metric in one direction

If you want to move, for example, the uninsured rate down:

1. Pass a strong federal healthcare spending bill (extreme-left option on the relevant legislation type).
2. Each turn, the metric ticks down by ~0.06 and approaches a lower target via exponential decay.
3. Opposing legislation (from opponents) partially cancels your effect. Net direction depends on the sum of all active policies.

### Long-run vs. short-run effects

- **Short run:** The exponential decay component creates visible movement in the first dozen turns after a bill passes.
- **Long run:** Tick rates compound over many turns. Extreme legislation held in place for 5+ game years produces structural changes that take decades of in-game time to reverse.
- **Adaptation half-life:** For legislation types with adaptation decay, the short-run spike fades but the steady-state component remains until the law is repealed.

### Repealing bad policy

There is no explicit repeal mechanic. To reverse a policy, pass a bill selecting the opposite option on the same legislation type. The new bill overwrites the old enacted-law record, and the metric begins tracking toward the new target.

## Related pages

- [Bills & Legislation](/wiki/bills-legislation): how to propose and pass bills
- [Voting & Whips](/wiki/voting-and-whips): influencing how the chamber votes
- [Congress Leadership](/wiki/congress-leadership): who controls the legislative agenda
`;
