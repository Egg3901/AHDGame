export const blocSpheresContent = `# Bloc Alignment & Spheres of Influence

The Cold War era layer tracks two related things: how drawn a nation is toward each pole (alignment) and which patron the nation actually belongs to right now (its sphere). Alignment is the cause; sphere membership is the effect that follows from it.

## Alignment shares

Every nation carries a share (0-100) toward each pole in the current era, plus an uncommitted remainder. Shares across all poles and the remainder always sum to 100. The gap between a nation's top pole and its next-highest is its **lead**, and lead is what most thresholds are measured against:

- **85 lead (locked).** A nation this committed is immovable by ordinary passive drift; only a deliberate influence play can shift it further.
- **20 lead or below (non-aligned band).** A genuinely uncommitted nation resists drift at half the normal rate, so it does not get accidentally nudged into a bloc.

## Joining and leaving a bloc

Whether a nation can join, or is drifting toward leaving, an alignment-governed organization (a bloc, alliance, or similar channel) is measured on the nation's **share in that org's pole specifically**, not its overall lead:

- **Share at or above 60** means the nation may join.
- **Share at or below 40** means an existing member is heading for the door (flagged as wanting out).
- **Between 41 and 59 is a deadband.** Nothing happens here. This stops a member flapping in and out of its bloc on a few points of ordinary drift.

A nation has to hold past one of these thresholds for a sustained run of turns (half a game year) before the world actually acts on it, joining, leaving, or feeding into bloc stress. A one-turn spike does not trigger anything.

The Non-Aligned Movement is a special case: it has no pole of its own, so its "share" is read off the uncommitted remainder against the same 60/40 gates.

## Passive drift

Alignment shares move a little on their own every turn, but this background drift is deliberately small: a player's own influence play always outweighs it. A few things shape how it lands:

- Opposing pulls on different poles cancel out before anything else is applied, so only the net direction matters.
- Pulls toward the same pole simply add together.
- Movement in a single turn is capped, and the cap is larger for a nation currently caught in an open crisis, so a live flashpoint can move faster than routine drift.
- Standing membership in an alignment-linked organization exerts its own small constant pull toward that org's pole. This pull alone can carry a nation up to a ceiling well short of the locked threshold; getting a nation past that ceiling and toward being locked in takes a deliberate play, not just sitting in the organization.

## Bloc stress

A bloc's own cohesion is modeled separately from any one member's alignment. An alliance that expands fast does not automatically defend everything it holds as well as a smaller, settled bloc would. Stress is a single 0-1 gauge built from three things about the bloc's own membership:

- **Contested members.** Members a rival pole is actively pulling at cost attention; members nobody is contesting cost nothing.
- **Members heading for the door.** The same sustained "wants out" signal used for leaving thresholds.
- **Recent accessions.** Members who joined within roughly the last quarter game-year are still being digested. This cost decays over time, it is a transition cost, not a permanent tax on being large.

Raw member count is deliberately not an input: a large bloc of settled, uncontested members is not penalized just for its size.

Stress reduces how effectively the bloc's own plays land, up to a cap: a fully-stressed bloc is meaningfully impaired but never completely inert. It bucket into three player-facing labels: **Settled**, **Strained**, and **Overextended**. Stress is self-correcting; it falls back down as contested members settle and accessions finish digesting, with no action required from anyone.

## What this means for you

- Watch your bloc's stress label before pushing to add more members fast. A string of new accessions or a run of contested members will blunt your bloc's own plays for a while.
- A member sitting in the 41-59 deadband on your pole is not actually at risk of leaving yet; do not waste effort trying to "save" it.
- A member below 40 for a sustained stretch is a real defection risk and will start showing up in your bloc's stress.
- Passive membership alone will not lock a nation into your sphere. If you want a nation genuinely committed (past the locked threshold), you need deliberate influence plays, not just organizational membership.
- Crossing into a new alignment era re-maps every nation's shares onto the new era's poles once, automatically; a pole that has no successor in the new era returns its share to the uncommitted pool rather than vanishing.

See also: [Conflicts & the Military System](/wiki/conflicts-overview), [International Organizations](/wiki/international-organizations).
`;
